# Sumo pool

Een webapp waarin iedereen op zijn eigen telefoon met MX inzet op een sumotoernooi. Alles staat in een Upstash Redis-database achter de site, dus geen enkele telefoon is onmisbaar: die van jou mag leeg raken zonder dat er iets verloren gaat.

- Iedereen begint met **50 MX**. Er is geen manier om bij te kopen: op is op.
- **Voorspelronde** vooraf: kies de kampioen en zet in op de eerste ronde, daarna kun je je telefoon wegleggen.
- **Accounts** met alleen een gebruikersnaam. De site geeft je een pincode van 4 cijfers. Geen e-mail, geen wachtwoord.
- Het **masterscherm** sluit het inzetten en vult per match de winnaar in. Uitbetalen gaat direct, daarna kan er weer worden ingezet.

## Live zetten (ongeveer 10 minuten)

1. Zet de map `sumo-pool` in een nieuwe GitHub-repository (privé mag).
2. Kies in Vercel Add New, dan Project, importeer de repository en deploy. De site zegt nu "De database is nog niet gekoppeld". Dat klopt.
3. Ga in het Vercel-project naar het tabblad Storage en voeg **Upstash for Redis** toe (gratis plan). Kies **Frankfurt** als regio, want de functies draaien daar ook (zie `vercel.json`). Koppel het aan dit project voor alle omgevingen.
4. Deploy opnieuw, zodat de app de databasesleutels krijgt. Vercel zet `KV_REST_API_URL` en `KV_REST_API_TOKEN` er zelf in; de app leest die automatisch.
5. Open de site, maak een account aan, ga naar **Account** en dan **Mastertoegang**. Daar kies je een masterpincode, vul je de namen in en loot je het schema.

Geen GitHub? Draai `npx vercel` in deze map, koppel de storage in het dashboard en draai daarna `npx vercel --prod`.

## Een dag van tevoren

Doe een proefronde met drie telefoons: account aanmaken, inzetten, inzetten sluiten, winnaar invullen. Druk daarna op **Nieuw toernooi starten** in het masterscherm. Alle inzetten en uitslagen verdwijnen, iedereen begint weer met 50 MX en houdt zijn account.

Geef de masterpincode aan één iemand die je vertrouwt. Die kan het toernooi vanaf zijn eigen telefoon overnemen als die van jou uitvalt.

## Op de avond zelf

- Deel de link. Een QR-code aan de muur werkt het beste.
- Laat mensen hun account aanmaken en **hun pincode opschrijven of screenshotten**. Ze kunnen hem later terugvinden onder Account.
- De voorspelronde loopt tot je de eerste match sluit. Daarna gaat de kampioensvoorspelling op slot; inzetten op losse matches blijft gewoon doorgaan.
- Per match: **Inzetten sluiten** als ze de mat op stappen, daarna tik je op de naam van de winnaar. Iedereen is meteen uitbetaald en de volgende match staat open.
- Wil je de spanning erin houden, tik dan op **Ronde voor ronde bijhouden**. Daar staat ook de klok van 60 seconden.
- Verkeerd getikt? **Terugdraaien** haalt de laatste actie terug, inclusief een uitslag. Alle saldo's rekenen zichzelf opnieuw uit.
- Pincode vergeten? Masterscherm, **Iemand helpen inloggen**, zoek de naam. Je ziet de pincode staan of geeft een nieuwe.
- Telefoon leeg? Inloggen op een andere telefoon met dezelfde gebruikersnaam en pincode. Inzetten en saldo staan er gewoon nog.

## Hoe het eerlijk blijft

- De server rekent elke inzet na tegen je saldo, ook als er tien tegelijk binnenkomen. Je kunt nooit onder nul.
- Zodra het inzetten dicht is, worden late inzetten geweigerd.
- Een match wordt afgerekend op de inzetten zoals ze op dat moment echt staan, dus de pot klopt altijd met wat mensen op hun scherm zagen.
- Uitbetaling is parimutuel: de hele pot wordt verdeeld over wie de winnaar had, naar rato van de inzet. Had niemand de winnaar, dan krijgt iedereen zijn inzet terug.
- Terugdraaien is veilig omdat elk saldo wordt afgeleid uit de inzetten plus de uitslagen. Er staat nergens een los potje geld dat kan gaan afwijken.

## Noodgevallen

- **Masterpincode kwijt.** Open de database via het tabblad Storage in Vercel (Upstash-console) en verwijder de sleutel `mx:masterpin`. Tik daarna op Mastertoegang en kies een nieuwe. Schema en inzetten blijven staan.
- **Buitengesloten na tien foute pogingen.** Wacht 10 minuten, of verwijder de sleutel `mx:fails:master`.
- **Alles wissen en opnieuw beginnen.** Nieuw toernooi starten in het masterscherm.

## Hoeveel het aankan

De publieke stand is voor iedereen hetzelfde, dus Vercel bewaart hem een seconde op het randnetwerk. Honderd telefoons die tegelijk verversen worden zo een handvol serveraanvragen. Daarachter deelt elke serverinstantie één momentopname van het toernooi.

Een test met 140 telefoons die tegelijk polden en inzetten terwijl de master matches afhandelde: geen fouten, de stand kwam terug in 2 milliseconden (mediaan), een inzet in 5. Dat was met een veel hoger inzettempo dan een echte zaal haalt, en het kwam uit op ongeveer 35 databaseopdrachten per seconde. Het gratis Upstash-plan geeft 500.000 opdrachten per maand, dus een avond past daar ruim in.

## Lokaal draaien

```
npm install
npm run dev
```

Zonder databasesleutels draait de app in testmodus en houdt hij alles in het geheugen tot je de server herstart.
