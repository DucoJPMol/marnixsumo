export const K = {
  ver: "mx:ver",
  state: "mx:state",
  masterPin: "mx:masterpin",
  users: "mx:users", // uid -> { name, pin, at }
  names: "mx:names", // lowercase name -> uid
  tokens: "mx:tokens", // token -> uid
  bets: "mx:bets", // uid -> { b: { markt: [keuze, bedrag] }, c: [keuze, bedrag] }
  masterFails: "mx:fails:master",
  masterLock: "mx:lock:master",
  userFails: (uid) => `mx:fails:${uid}`,
  userLock: (uid) => `mx:lock:${uid}`,
  loginFails: (key) => `mx:login:${key}`,
};
