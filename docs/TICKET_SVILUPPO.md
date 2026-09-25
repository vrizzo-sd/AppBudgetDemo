# Ticket di sviluppo proposti

Aggiornamento: 25/09/2026.

I ticket sono ordinati per dipendenza. I testi possono essere copiati nel sistema di gestione attività; prima dell'apertura effettiva vanno assegnati al repository/modulo Wingest corretto e associati alle etichette disponibili.

---

## T01 — Analizzare l'integrazione del budget analitico nell'architettura Wingest

### Obiettivo

Individuare componenti, archivi e servizi Wingest da riusare e produrre il mapping tecnico tra il mockup e l'ERP, evitando la creazione di entità duplicate.

### Attività

- Identificare il modulo applicativo che ospiterà la funzione.
- Mappare budget, CDC/livelli, commesse, sottoconti, utenti, ruoli e documenti allegati sugli oggetti esistenti.
- Verificare come la UI deve accedere ai dati attraverso i servizi backend previsti dall'architettura Wingest.
- Documentare differenze tra schema demo e modello definitivo.
- Registrare le decisioni D-01, D-02, D-03, D-04 e D-15.

### Criteri di accettazione

- Esiste una tabella di mapping mockup → Wingest con oggetto, chiave, proprietario del dato e modalità di accesso.
- È identificato il modulo/repository di implementazione.
- Sono elencate le entità da riusare e quelle realmente nuove.
- Le decisioni ancora aperte hanno responsabile e impatto dichiarati.

### Dipendenze

Nessuna. Blocca i ticket T02, T03 e T04.

---

## T02 — Definire e creare il modello dati relazionale del budget

### Obiettivo

Realizzare il modello persistente definitivo per intestazioni, livelli, voci, periodi, versioni e riepiloghi, coerente con le convenzioni Wingest.

### Attività

- Definire chiavi, vincoli di unicità, stati controllati e relazioni.
- Memorizzare gli importi con tipo decimale adeguato o in centesimi secondo lo standard scelto.
- Impedire la duplicazione di totali calcolabili.
- Prevedere audit e gestione non distruttiva degli oggetti approvati.
- Creare migrazioni e test di integrità referenziale.

### Criteri di accettazione

- Un budget rispetta la chiave univoca concordata.
- Il codice livello è univoco nel budget.
- Esiste una sola riga per voce e periodo.
- Costi e ricavi mantengono natura distinta e validata.
- I riepiloghi derivano dal dettaglio e non sono modificabili direttamente.
- Le migrazioni sono ripetibili in un ambiente vuoto e coperte da test.

### Dipendenze

T01 e decisioni D-01–D-04.

---

## T03 — Implementare ruoli, autorizzazioni e ciclo di vita

### Obiettivo

Definire e applicare le autorizzazioni per consultazione, redazione, invio e approvazione di budget, rettifiche e CAPEX.

### Attività

- Formalizzare stati e transizioni ammesse.
- Mappare i ruoli Wingest alle operazioni.
- Applicare i controlli nel backend e rifletterli nella UI.
- Registrare attore, data e motivazione delle transizioni.
- Restituire un errore esplicito per ogni operazione non autorizzata o transizione non valida.

### Criteri di accettazione

- Ogni transizione ha origine, destinazione e ruolo autorizzato documentati.
- Un utente senza permesso non può eseguire l'operazione neppure chiamando direttamente il servizio.
- Ogni cambio di stato è ricostruibile dall'audit.
- Gli oggetti approvati non sono cancellabili fisicamente attraverso l'applicazione.

### Dipendenze

T01 e decisioni D-04–D-06.

---

## T04 — Implementare i servizi applicativi del budget ordinario

### Obiettivo

Fornire operazioni backend transazionali per elenco, dettaglio, creazione e modifica di budget, livelli, voci e valori mensili.

### Attività

- Esporre letture filtrate per esercizio, tipo, versione, stato e struttura secondo i filtri approvati.
- Implementare creazione/modifica di intestazione e livello come operazioni distinte.
- Implementare salvataggio atomico di voce e dodici periodi.
- Validare sottoconto, natura, duplicati e appartenenza al livello.
- Implementare redistribuzione atomica mantenendo il totale richiesto.
- Gestire la concorrenza con versione/ETag o meccanismo equivalente.

### Criteri di accettazione

- Le validazioni non possono essere aggirate dal client.
- Due modifiche concorrenti non si sovrascrivono silenziosamente.
- Un errore non lascia righe parziali.
- Dopo la scrittura il servizio restituisce o consente di rileggere i totali confermati.
- Il sottoconto viene verificato sull'anagrafica Wingest e sulla natura ammessa.

### Dipendenze

T01 e T02.

---

## T05 — Realizzare la gestione di budget e livelli nella UI Wingest

### Obiettivo

Riprodurre nell'applicazione Wingest l'elenco gerarchico del mockup con filtri, creazione, modifica e apertura dell'analisi.

### Attività

- Mostrare intestazione del budget e livelli sottostanti.
- Rendere operativi solo i filtri approvati, eliminando o disabilitando quelli non supportati.
- Gestire creazione e modifica con messaggi di validazione chiari.
- Aprire l'intero budget oppure un singolo livello mantenendo lo scope selezionato.
- Applicare visibilità e azioni in base a stato e ruolo.

### Criteri di accettazione

- L'apertura dell'intestazione GRANA include GRA-001, GRA-002 e GRA-003; l'apertura di GRA-001 esclude gli altri livelli.
- Un codice livello duplicato viene rifiutato sia in creazione sia in modifica.
- I filtri mostrati modificano realmente i risultati.
- Un salvataggio fallito non viene presentato come riuscito.

### Dipendenze

T03 e T04.

---

## T06 — Realizzare la redazione mensile del budget ordinario

### Obiettivo

Implementare le tabelle 1, 2 e 3 per costi e ricavi, con aggiunta di voci e redistribuzione mensile.

### Attività

- Mostrare riepilogo livelli, riepilogo voci/sottoconti e pianificazione gennaio–dicembre.
- Separare le schede Costi e Ricavi.
- Aggiungere una voce con descrizione libera, sottoconto valido, importo e ripartizione iniziale.
- Implementare “Ripartisci” senza modificare implicitamente il totale.
- Rileggere dal backend i riepiloghi dopo il salvataggio.

### Criteri di accettazione

- Per un budget ordinario sono visibili le tabelle 1, 2 e 3 e non la tabella CAPEX.
- La tabella 1 non mostra la durata.
- Un nuovo costo da 1.200 € incrementa di 1.200 € la riga, la voce e il livello senza duplicazioni.
- La stessa combinazione livello, sottoconto, voce e natura non può essere duplicata.
- Un sottoconto non può essere usato con natura opposta senza la regola esplicitamente approvata.

### Dipendenze

T04 e T05.

---

## T07 — Implementare rettifiche e processo di approvazione

### Obiettivo

Gestire le variazioni senza sovrascrivere il budget base e applicarle ai totali solo dopo l'approvazione.

### Attività

- Creare rettifiche con destinazione, periodo, importo, motivazione e riferimento documentale.
- Implementare invio, approvazione e rifiuto secondo ruoli e transizioni concordati.
- Conservare storico e audit completi.
- Aggiornare i riepiloghi in modo transazionale allo stato approvato.
- Prevenire il doppio conteggio tra rettifica economica e rettifica CAPEX collegata.

### Criteri di accettazione

- Bozza, In approvazione e Respinta sono visibili nello storico ma non modificano i totali ufficiali.
- Approvata modifica il totale una sola volta.
- Una decisione registra attore, data, esito e nota.
- Un errore durante l'approvazione non lascia budget e CAPEX disallineati.
- Il caso 60.000 € + 20.000 € produce 80.000 €, non 100.000 €.

### Dipendenze

T02, T03, T04 e decisione D-06.

---

## T08 — Implementare servizi e regole del piano CAPEX

### Obiettivo

Gestire voci di investimento, collegamento al budget, pagamenti pluriennali, fonti e riconciliazioni.

### Attività

- Persistenza di commessa, voce collegata, sottoconto, fonte, vita utile, date, stato e importi.
- Piano manuale, rate al fornitore e finanziamento con capitale/interessi separati.
- Validazione in centesimi della somma capitale = CAPEX aggiornato.
- Lettura annuale delle dodici colonne e calcolo del capitale residuo.
- Gestione atomica del collegamento tra voce CAPEX e voce budget.
- Applicazione della regola di ammortamento validata o integrazione con i cespiti.

### Criteri di accettazione

- Un piano con capitale 81.000 € e CAPEX aggiornato 80.000 € viene rifiutato.
- Un finanziamento da 100.000 € in 120 rate conserva capitale totale 100.000 € e interessi distinti.
- Le rate restano disponibili oltre l'anno del budget.
- Cambiare la data di una rata non sposta automaticamente il calendario del budget.
- La modifica totale mantiene allineati CAPEX e voce budget senza doppio conteggio.

### Dipendenze

T02, T04, T07 e decisioni D-07–D-11.

---

## T09 — Realizzare la redazione del budget di investimento e la tabella CAPEX

### Obiettivo

Implementare nella UI Wingest il percorso di investimento mantenendo distinta la vista di budget dalla vista dei pagamenti.

### Attività

- Mostrare tabelle 1 e 2 e, al posto della tabella 3, la tabella CAPEX.
- Rendere modificabile la fonte del livello secondo la decisione D-08.
- Mostrare Commessa, Voce, Fonte, Vita utile, Stato, Gen–Dic, Pagamenti anno, Residuo, CAPEX iniziale, Rettifiche, CAPEX aggiornato e Ammortamento.
- Consentire modifica da azione e da cella mensile.
- Consentire selezione dell'anno per piani pluriennali.
- Presentare messaggi distinti per errori di capitale, piano da rigenerare e dati mancanti.

### Criteri di accettazione

- Per un investimento la tabella 3 ordinaria è nascosta e la tabella CAPEX è visibile.
- La colonna si chiama “Voce” e non è mostrata “Categoria”.
- Le dodici colonne cambiano con l'anno selezionato.
- Piano pagamenti e budget non vengono sommati due volte.
- Dati salvati, fonti e piani restano disponibili dopo un nuovo accesso.

### Dipendenze

T03, T05 e T08.

---

## T10 — Ampliare test, migrazione, riconciliazione e collaudo

### Obiettivo

Dimostrare che dati, calcoli, permessi e flussi sono corretti prima del rilascio.

### Attività

- Definire la strategia di migrazione dalle eventuali fonti approvate.
- Confrontare totali per budget, livello, voce, mese, rettifica e CAPEX.
- Aggiungere test unitari, integrazione, UI e autorizzazione.
- Testare concorrenza, rollback transazionale e messaggi di errore.
- Verificare accessibilità di tabelle, dialoghi e navigazione da tastiera.
- Documentare esito, anomalie accettate e procedura di rollback.

### Criteri di accettazione

- La riconciliazione non presenta differenze non spiegate.
- Sono coperti almeno i nove criteri della specifica funzionale.
- Sono presenti test negativi per duplicati, natura conto, permessi, transizioni e capitale incoerente.
- Un guasto durante una scrittura atomica non lascia dati parziali.
- Il collaudo identifica chiaramente funzioni incluse ed escluse dal rilascio.

### Dipendenze

T05, T06, T07 e T09.
