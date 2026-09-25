# Budget analitico Wingest — indice della documentazione

Aggiornamento: 25/09/2026.

Questa cartella raccoglie la documentazione funzionale e tecnica del mockup `AppBudgetDemo` e il materiale di passaggio allo sviluppo. Il progetto corrente è un prototipo locale: mostra e verifica i flussi proposti, ma non è ancora integrato con Wingest e non costituisce un'architettura di produzione.

## Ordine di lettura consigliato

1. [`ANALISI_STATO_ATTUALE_E_GAP.md`](ANALISI_STATO_ATTUALE_E_GAP.md) — fotografia verificata del mockup, limiti e differenze rispetto all'applicazione reale.
2. [`SPECIFICA_SVILUPPATORE_BUDGET_WINGEST.md`](SPECIFICA_SVILUPPATORE_BUDGET_WINGEST.md) — requisiti funzionali, formule e criteri di accettazione di riferimento.
3. [`ARCHITETTURA_DATABASE.md`](ARCHITETTURA_DATABASE.md) — proposta di modello dati e percorso di evoluzione dalla persistenza JSON.
4. [`DECISIONI_DA_VALIDARE.md`](DECISIONI_DA_VALIDARE.md) — domande che richiedono una decisione funzionale o tecnica prima dello sviluppo definitivo.
5. [`PIANO_IMPLEMENTAZIONE.md`](PIANO_IMPLEMENTAZIONE.md) — sequenza di realizzazione, dipendenze e condizioni di completamento.
6. [`TICKET_SVILUPPO.md`](TICKET_SVILUPPO.md) — ticket pronti da riportare nel sistema di gestione attività.

## Come leggere le affermazioni

Nei documenti vengono mantenuti tre stati distinti:

- **Implementato nel mockup**: comportamento riscontrabile nel codice corrente e, dove possibile, verificato localmente.
- **Proposta per l'ERP**: soluzione descritta nelle specifiche, ma non ancora presente né validata nell'architettura Wingest.
- **Da validare**: scelta che può modificare dati, flusso, permessi, calcoli o integrazioni e che non deve essere decisa implicitamente dal programmatore.

## Fonti analizzate

- interfaccia e flussi: `index.html`, `assets/js/app.js`, `assets/js/components/`;
- dati demo e calcoli: `assets/js/data/demo-data.js`, `assets/js/core/capex-plan.js`;
- persistenza e API locali: `server.py`, `schema.sql`;
- proiezione relazionale: `schema_normalizzato.sql`, `scripts/init_normalized_db.py`, `query_esempio.sql`;
- verifiche automatiche: `tests/capex-plan.test.mjs`;
- documentazione preesistente: `README.md`, `SPECIFICA_SVILUPPATORE_BUDGET_WINGEST.md`, `ARCHITETTURA_DATABASE.md`.

## Confine del lavoro

Il backlog copre gestione budget ordinario, budget di investimento, pianificazione mensile, rettifiche, CAPEX, persistenza, permessi e integrazioni necessarie. Il caricamento dei consuntivi contabili, gli impegni e il calcolo degli scostamenti non sono implementati nel mockup e restano fuori dal perimetro finché non vengono richiesti e specificati esplicitamente.
