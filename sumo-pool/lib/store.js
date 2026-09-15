import { Redis } from "@upstash/redis";

function asString(value) {
  if (value === null || value === undefined) return null;
  return typeof value === "string" ? value : JSON.stringify(value);
}

// With automatic deserialization off, HGETALL comes back as a flat
// [field, value, ...] array. Accept an object too, in case that ever changes.
function toObject(result) {
  const out = {};
  if (!result) return out;
  if (Array.isArray(result)) {
    for (let i = 0; i + 1 < result.length; i += 2) out[String(result[i])] = asString(result[i + 1]);
    return out;
  }
  if (typeof result === "object") {
    Object.entries(result).forEach(([k, v]) => {
      out[k] = asString(v);
    });
  }
  return out;
}

class UpstashStore {
  constructor(url, token) {
    this.kind = "redis";
    this.redis = new Redis({
      url,
      token,
      automaticDeserialization: false,
      enableAutoPipelining: false,
      enableTelemetry: false,
    });
  }

  async get(key) {
    return asString(await this.redis.get(key));
  }

  async set(key, value) {
    await this.redis.set(key, String(value));
  }

  async setIfAbsent(key, value) {
    return (await this.redis.set(key, String(value), { nx: true })) === "OK";
  }

  async lock(key, value, ttlMs) {
    return (await this.redis.set(key, String(value), { nx: true, px: ttlMs })) === "OK";
  }

  async del(...keys) {
    if (keys.length) await this.redis.del(...keys);
  }

  async incr(key) {
    return Number(await this.redis.incr(key));
  }

  async expire(key, seconds) {
    await this.redis.expire(key, seconds);
  }

  async hget(key, field) {
    return asString(await this.redis.hget(key, field));
  }

  async hset(key, field, value) {
    await this.redis.hset(key, { [field]: String(value) });
  }

  async hsetnx(key, field, value) {
    return Number(await this.redis.hsetnx(key, field, String(value))) === 1;
  }

  async hdel(key, field) {
    await this.redis.hdel(key, field);
  }

  async hlen(key) {
    return Number(await this.redis.hlen(key));
  }

  async hgetall(key) {
    return toObject(await this.redis.hgetall(key));
  }

  async batch(commands) {
    const pipeline = this.redis.pipeline();
    commands.forEach(([cmd, key, field]) => {
      if (cmd === "hgetall") pipeline.hgetall(key);
      else if (cmd === "hget") pipeline.hget(key, field);
      else if (cmd === "hlen") pipeline.hlen(key);
      else pipeline.get(key);
    });
    const results = await pipeline.exec();
    return results.map((value, i) => {
      const cmd = commands[i][0];
      if (cmd === "hgetall") return toObject(value);
      if (cmd === "hlen") return Number(value) || 0;
      return asString(value);
    });
  }

  async writeBatch(commands) {
    const pipeline = this.redis.pipeline();
    commands.forEach(([cmd, key, field, value]) => {
      if (cmd === "hset") pipeline.hset(key, { [field]: String(value) });
      else if (cmd === "hdel") pipeline.hdel(key, field);
      else if (cmd === "set") pipeline.set(key, String(field));
      else if (cmd === "del") pipeline.del(key);
      else if (cmd === "incr") pipeline.incr(key);
    });
    await pipeline.exec();
  }
}

// Local development only. Vercel runs many instances that share no memory,
// so this is never used there.
export class MemoryStore {
  constructor() {
    this.kind = "memory";
    this.data = new Map();
    this.expiry = new Map();
  }

  alive(key) {
    const until = this.expiry.get(key);
    if (until !== undefined && until <= Date.now()) {
      this.data.delete(key);
      this.expiry.delete(key);
    }
    return this.data.has(key);
  }

  hash(key, create) {
    const existing = this.alive(key) ? this.data.get(key) : null;
    if (existing instanceof Map) return existing;
    if (!create) return null;
    const fresh = new Map();
    this.data.set(key, fresh);
    return fresh;
  }

  async get(key) {
    if (!this.alive(key)) return null;
    const value = this.data.get(key);
    return typeof value === "string" ? value : null;
  }

  async set(key, value) {
    this.data.set(key, String(value));
    this.expiry.delete(key);
  }

  async setIfAbsent(key, value) {
    if (this.alive(key)) return false;
    this.data.set(key, String(value));
    return true;
  }

  async lock(key, value, ttlMs) {
    if (this.alive(key)) return false;
    this.data.set(key, String(value));
    this.expiry.set(key, Date.now() + ttlMs);
    return true;
  }

  async del(...keys) {
    keys.forEach((k) => {
      this.data.delete(k);
      this.expiry.delete(k);
    });
  }

  async incr(key) {
    const n = Number((await this.get(key)) || 0) + 1;
    this.data.set(key, String(n));
    return n;
  }

  async expire(key, seconds) {
    if (this.alive(key)) this.expiry.set(key, Date.now() + seconds * 1000);
  }

  async hget(key, field) {
    const h = this.hash(key, false);
    return h && h.has(field) ? h.get(field) : null;
  }

  async hset(key, field, value) {
    this.hash(key, true).set(field, String(value));
  }

  async hsetnx(key, field, value) {
    const h = this.hash(key, true);
    if (h.has(field)) return false;
    h.set(field, String(value));
    return true;
  }

  async hdel(key, field) {
    const h = this.hash(key, false);
    if (h) h.delete(field);
  }

  async hlen(key) {
    const h = this.hash(key, false);
    return h ? h.size : 0;
  }

  async hgetall(key) {
    const h = this.hash(key, false);
    return h ? Object.fromEntries(h) : {};
  }

  async batch(commands) {
    const out = [];
    for (const [cmd, key, field] of commands) {
      if (cmd === "hgetall") out.push(await this.hgetall(key));
      else if (cmd === "hget") out.push(await this.hget(key, field));
      else if (cmd === "hlen") out.push(await this.hlen(key));
      else out.push(await this.get(key));
    }
    return out;
  }

  async writeBatch(commands) {
    for (const [cmd, key, field, value] of commands) {
      if (cmd === "hset") await this.hset(key, field, value);
      else if (cmd === "hdel") await this.hdel(key, field);
      else if (cmd === "set") await this.set(key, field);
      else if (cmd === "del") await this.del(key);
      else if (cmd === "incr") await this.incr(key);
    }
  }
}

export function getStore() {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  if (url && token) {
    if (!globalThis.__mxRedis) globalThis.__mxRedis = new UpstashStore(url, token);
    return globalThis.__mxRedis;
  }
  if (process.env.VERCEL) return null;
  if (!globalThis.__mxMemory) globalThis.__mxMemory = new MemoryStore();
  return globalThis.__mxMemory;
}
