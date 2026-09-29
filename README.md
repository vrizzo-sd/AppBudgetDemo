# AppBudgetDemo — Mockup Budget Analitico Wingest

Questa è la **cartella unica e corrente** del progetto. Apri `AppBudgetDemo` in VS Code, non la cartella che la contiene. Il repository Git conserva lo storico delle versioni; i database locali e lo ZIP di consegna sono generati e non devono essere caricati su GitHub.

Piccolo ambiente modulare e modificabile in Visual Studio Code, composto da:

- `index.html`: struttura delle schermate;
- `assets/css/styles.css`: colori e impaginazione Wingest;
- `assets/js/app.js`: coordinamento, stato ed eventi dell'applicazione;
- `assets/js/components/`: componenti che costruiscono le singole tabelle;
- `assets/js/data/demo-data.js`: dataset dimostrativo separato dalla logica;
- `assets/js/core/formatters.js`: formattatori e funzioni condivise;
- `assets/js/core/budget-hierarchy.js`: gerarchia, percentuali e controlli della pianificazione;
- `assets/js/core/capex-plan.js`: logica CAPEX legacy conservata ma non esposta nella nuova redazione;
- `server.py`: mini server locale scritto con la sola libreria standard Python;
- `schema.sql`: struttura del piccolo database SQLite;
- `schema_normalizzato.sql`: schema relazionale pensato per l'applicazione;
- `scripts/init_normalized_db.py`: migrazione rigenerabile dal mockup al database relazionale;
- `query_esempio.sql`: query pronte per gestione, analisi, rettifiche e CAPEX;
- `docs/ARCHITETTURA_DATABASE.md`: proposta di database normalizzato per l'evoluzione reale;
- `data/budget_mockup.db`: database creato automaticamente al primo avvio;
- `.vscode/tasks.json`: comando pronto per avviare il progetto da VS Code.

La versione monolitica precedente non fa parte del progetto corrente: il server usa `index.html`.

Non servono `npm`, pacchetti Python o connessioni esterne.

Per controllare gerarchia, versioning e calcoli legacy CAPEX, se Node.js è disponibile: `node --test tests/*.test.mjs`. Node.js è facoltativo per l'uso del mockup.

## Avvio rapido

1. Aprire questa cartella in Visual Studio Code.
2. Aprire il menu **Terminale > Esegui attività**.
3. Scegliere **Avvia mockup Budget Wingest**.
4. Aprire nel browser `http://127.0.0.1:8793`.

La porta `8793` è dedicata alla versione modulare aggiornata. Eventuali vecchi server sulla porta `8787` possono ancora mostrare la precedente pagina monolitica.

In alternativa, su Windows fare doppio clic su `start.bat`.

## Pacchetto da consegnare allo sviluppatore

Il file pronto da copiare o condividere è `dist/Mockup_Budget_Analitico_Wingest_sviluppatore.zip`. Estrarlo, aprire la cartella estratta in VS Code e avviare `start.bat` oppure `python server.py`. Aprire la pagina una volta per generare i dati demo. In SQLTools creare poi una connessione SQLite al file `data/budget_wingest.db` della cartella estratta e provare `query_esempio.sql`. Lo schema completo è `schema_normalizzato.sql`, il modello concettuale e le regole sono in `docs/SPECIFICA_SVILUPPATORE_BUDGET_WINGEST.md` e `docs/ARCHITETTURA_DATABASE.md`.

Lo ZIP esclude i database locali di lavoro. Per rigenerarlo dopo modifiche al mockup: `python scripts/create_developer_package.py`.

## Dove modificare il frontend

- struttura e testi delle schermate: `index.html`;
- stile grafico: `assets/css/styles.css`;
- dati demo, stato ed eventi: `assets/js/app.js`;
- dati demo iniziali: `assets/js/data/demo-data.js`;
- tabella gestione budget: `assets/js/components/budget-list.js`;
- tabelle dell'analisi: `assets/js/components/analysis-tables.js`;
- tabella CAPEX: `assets/js/components/capex-table.js`;
- elenco rettifiche: `assets/js/components/adjustment-list.js`;
- popup di ripartizione: `assets/js/components/distribution-table.js`;
- formattazione euro, codici e stati: `assets/js/core/formatters.js`.

I componenti sono funzioni JavaScript pure: ricevono dati e restituiscono HTML. `app.js` conserva le regole applicative e collega pulsanti, filtri, popup e persistenza.

Nella schermata **Gestione Budget** ogni riga rappresenta una versione del budget. Le precedenti righe bianche di dettaglio e il comando **Aggiungere voci** non sono più esposti: la gestione avviene tramite versioning. **Copia** duplica il budget assegnandogli il numero di versione successivo e lo imposta inizialmente come `Disattivo`; **Elimina** richiede una conferma e non permette di rimuovere l’ultimo budget rimasto. Gli unici stati dell’intestazione sono `Attivo`, con l’intera riga verde, e `Disattivo`, con l’intera riga grigia. La colonna **Struttura analitica associata** parte vuota; nel modulo resta un campo testuale libero, senza selezione vincolata a CDC o commessa.

La nuova **Redazione Budget Analitica** usa tre tabelle collegate. Per l'ordinario, il Livello 1 contiene il budget inserito dall'utente; il Livello 2 appartiene esplicitamente a un padre e il suo budget è calcolato dalla percentuale sul padre. Sono mostrate sia la percentuale sul padre sia quella sul totale generale. La pianificazione mensile contiene una riga per ogni elemento di Livello 2. Se la somma dei mesi non coincide con il budget calcolato, la riga diventa rossa e il salvataggio viene bloccato. Cambiando il budget del padre si ricalcolano i figli, ma non i mesi.

Per l'investimento/commessa il mockup usa un solo livello: nella prima tabella compaiono le righe di budget (per esempio costo personale o costo impianto), la seconda informa che non è previsto un Livello 2 e la terza mantiene la pianificazione mensile. Non esistono più le nature Costo/Ricavo, le voci e i sottoconti della precedente proposta. Tutte e tre le tabelle offrono lettura, aggiunta da elementi configurati, modifica e rimozione; codici e descrizioni non sono testo libero. Non esiste una colonna Azioni: selezionando una o più righe si attivano i comandi **Modifica** ed **Elimina** nell'intestazione della tabella. Un secondo clic su una riga selezionata la deseleziona. Senza selezione le tabelle mostrano tutte le righe; la selezione di uno o più Livelli 1 filtra l'unione dei figli collegati nel Livello 2 e la selezione di uno o più figli filtra le relative pianificazioni mensili. La cancellazione di una pianificazione rende il budget incompleto e ne impedisce il salvataggio finché la riga non viene riaggiunta e riallineata.

La specifica per lo sviluppatore Wingest è in `docs/SPECIFICA_SVILUPPATORE_BUDGET_WINGEST.md`. Il pacchetto distribuibile, privo dei database di lavoro, si genera con `scripts/create_developer_package.py`.

## SQLite

Il database contiene una tabella intenzionalmente molto piccola, `mockup_state`, che conserva lo stato completo del prototipo in JSON. È una scelta adatta al mockup perché rende semplice cambiare il modello durante la progettazione.

Il file `data/budget_wingest.db` è invece il database relazionale interrogabile con SQLTools. Il server lo rigenera automaticamente a partire dallo stato corrente dopo ogni salvataggio della pagina. In questo modo budget, livelli, voci, valori mensili, rettifiche, commesse e componenti CAPEX restano visibili anche tramite query SQL.

Nel mockup, `budget_mockup.db` (stato JSON) resta la sorgente delle modifiche; `budget_wingest.db` è la proiezione relazionale. Il server espone `GET /api/analysis?budgetId=...`, che legge le viste SQL `v_budget_level_summary` e `v_budget_item_totals` per aggiornare le tabelle 1 e 2. Per un'applicazione definitiva, il modello relazionale dovrebbe diventare la sorgente principale dei dati.

Per crearlo o riallinearlo manualmente si può usare:

```powershell
py -3 scripts\init_normalized_db.py --replace
```

Aprire `query_esempio.sql` per eseguire interrogazioni già pronte. Gli importi sono memorizzati in centesimi interi per evitare errori di arrotondamento e nelle query vengono divisi per `100.0` per mostrarli in euro.

Per la futura applicazione reale, leggere `docs/ARCHITETTURA_DATABASE.md`, che descrive tabelle, relazioni, vincoli e percorso di migrazione.

## Ripristino dati demo

Arrestare il server e cancellare `data/budget_mockup.db`. Al riavvio il database viene ricreato e la pagina reinserisce i dati demo.

Il progetto è un mockup locale: non è collegato a Wingest e non rappresenta ancora regole contabili validate.
