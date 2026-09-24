# Mockup Budget Analitico Wingest

Piccolo ambiente modulare e modificabile in Visual Studio Code, composto da:

- `index.html`: struttura delle schermate;
- `assets/css/styles.css`: colori e impaginazione Wingest;
- `assets/js/app.js`: coordinamento, stato ed eventi dell'applicazione;
- `assets/js/components/`: componenti che costruiscono le singole tabelle;
- `assets/js/data/demo-data.js`: dataset dimostrativo separato dalla logica;
- `assets/js/core/formatters.js`: formattatori e funzioni condivise;
- `server.py`: mini server locale scritto con la sola libreria standard Python;
- `schema.sql`: struttura del piccolo database SQLite;
- `schema_normalizzato.sql`: schema relazionale pensato per l'applicazione;
- `scripts/init_normalized_db.py`: migrazione rigenerabile dal mockup al database relazionale;
- `query_esempio.sql`: query pronte per gestione, analisi, rettifiche e CAPEX;
- `ARCHITETTURA_DATABASE.md`: proposta di database normalizzato per l'evoluzione reale;
- `data/budget_mockup.db`: database creato automaticamente al primo avvio;
- `.vscode/tasks.json`: comando pronto per avviare il progetto da VS Code.

Il precedente `Mockup_Budget_Analitico_Wingest.html` rimane come copia monolitica di riferimento, ma il server utilizza ora `index.html`.

Non servono `npm`, pacchetti Python o connessioni esterne.

## Avvio rapido

1. Aprire questa cartella in Visual Studio Code.
2. Aprire il menu **Terminale > Esegui attività**.
3. Scegliere **Avvia mockup Budget Wingest**.
4. Aprire nel browser `http://127.0.0.1:8793`.

La porta `8793` è dedicata alla versione modulare aggiornata. Eventuali vecchi server sulla porta `8787` possono ancora mostrare la precedente pagina monolitica.

In alternativa, su Windows fare doppio clic su `start.bat`.

## Pacchetto da consegnare allo sviluppatore

Il file pronto da copiare o condividere è `dist/Mockup_Budget_Analitico_Wingest_sviluppatore.zip`. Estrarlo, aprire la cartella estratta in VS Code e avviare `start.bat` oppure `python server.py`. Aprire la pagina una volta per generare i dati demo. In SQLTools creare poi una connessione SQLite al file `data/budget_wingest.db` della cartella estratta e provare `query_esempio.sql`. Lo schema completo è `schema_normalizzato.sql`, il modello concettuale e le regole sono in `SPECIFICA_SVILUPPATORE_BUDGET_WINGEST.md` e `ARCHITETTURA_DATABASE.md`.

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

La commessa di investimento usa le stesse prime tre tabelle del budget ordinario: le tabelle 1 e 2 restano riepiloghi compatti, con ricavi e costi separati; la tabella 3 espone la pianificazione mensile del budget. Nella tabella 1 non compare la durata; per i soli investimenti compare la **Fonte di finanziamento**, modificabile direttamente nella cella e salvata in SQLite. Solo per i budget di investimento compare anche la tabella 4, con tutte le colonne da gennaio a dicembre, la **Voce** CAPEX, fonte, vita utile, stato, CAPEX iniziale, rettifiche, CAPEX aggiornato e ammortamento. La categoria non è esposta nella tabella 4. Cliccando un importo mensile o **Modifica voce** si apre il modulo con dodici mesi. La somma dei pagamenti deve coincidere con il CAPEX aggiornato. Tabella 3 (distribuzione del budget) e tabella 4 (pagamenti) possono avere mesi diversi, ma lo stesso totale annuo per la voce collegata. Il dettaglio CAPEX non va sommato una seconda volta ai costi.

Nella Redazione Budget Analitica, **Tipo budget** permette di passare tra budget ordinari e di investimento; **Nome BDG** sceglie il budget del tipo selezionato. **＋ Nuova voce**, nell'intestazione della tabella 3 per entrambi i tipi, apre un modulo per scegliere livello, costo/ricavo, voce, sottoconto, importo e ripartizione iniziale. Dopo l'aggiunta, la tabella 3 mostra i valori mensili e le tabelle 2 e 1 ricalcolano subito i totali; dopo il salvataggio, i due riepiloghi vengono riletti dalle viste SQL del database relazionale. La successiva modifica delle rate si fa con **Ripartisci**. Per un investimento da capitalizzare con vita utile e piano pagamenti si usa **＋ Nuova voce CAPEX** nella tabella 4.

La specifica per lo sviluppatore Wingest è in `SPECIFICA_SVILUPPATORE_BUDGET_WINGEST.md`. Il pacchetto distribuibile, privo dei database di lavoro, si genera con `scripts/create_developer_package.py`.

## SQLite

Il database contiene una tabella intenzionalmente molto piccola, `mockup_state`, che conserva lo stato completo del prototipo in JSON. È una scelta adatta al mockup perché rende semplice cambiare il modello durante la progettazione.

Il file `data/budget_wingest.db` è invece il database relazionale interrogabile con SQLTools. Il server lo rigenera automaticamente a partire dallo stato corrente dopo ogni salvataggio della pagina. In questo modo budget, livelli, voci, valori mensili, rettifiche, commesse e componenti CAPEX restano visibili anche tramite query SQL.

Nel mockup, `budget_mockup.db` (stato JSON) resta la sorgente delle modifiche; `budget_wingest.db` è la proiezione relazionale. Il server espone `GET /api/analysis?budgetId=...`, che legge le viste SQL `v_budget_level_summary` e `v_budget_item_totals` per aggiornare le tabelle 1 e 2. Per un'applicazione definitiva, il modello relazionale dovrebbe diventare la sorgente principale dei dati.

Per crearlo o riallinearlo manualmente si può usare:

```powershell
& "C:\Users\Valentina.Rizzo\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe" scripts\init_normalized_db.py --replace
```

Aprire `query_esempio.sql` per eseguire interrogazioni già pronte. Gli importi sono memorizzati in centesimi interi per evitare errori di arrotondamento e nelle query vengono divisi per `100.0` per mostrarli in euro.

Per la futura applicazione reale, leggere `ARCHITETTURA_DATABASE.md`, che descrive tabelle, relazioni, vincoli e percorso di migrazione.

## Ripristino dati demo

Arrestare il server e cancellare `data/budget_mockup.db`. Al riavvio il database viene ricreato e la pagina reinserisce i dati demo.

Il progetto è un mockup locale: non è collegato a Wingest e non rappresenta ancora regole contabili validate.
