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

Nella tabella 3, **Rettifica** mostra le celle mensili delle variazioni sulla versione ufficiale approvata. Le colonne `Rett.` contengono la variazione cumulata rispetto al budget iniziale, con importi italiani (es. `1.000,50`). **Salva / invia rettifica** apre il box con motivazione obbligatoria: puoi salvare una bozza oppure inviare in approvazione. **Rettifiche e storico** consente ricerca, lettura, modifica ed eliminazione delle bozze, invio, ritiro, approvazione e rifiuto motivato. Le celle con richieste pendenti sono bloccate. Una richiesta può includere più celle, anche con variazione complessiva zero per uno spostamento tra mesi o voci. Solo l'approvazione cambia i totali ufficiali e crea una revisione immutabile, una per richiesta.

## Versioni, approvazioni e revisioni

- **Salva bozza** conserva anche un budget incompleto. Le modifiche alle griglie vengono autosalvate come stato di lavoro; i messaggi distinguono salvataggio in corso, conferma SQLite ed errore. L'invio in approvazione richiede livelli, percentuali e mesi quadrati.
- Gli stati dell'iter sono **Bozza**, **In approvazione**, **Approvato**, **Respinto** e sono distinti da **Attivo/Disattivo**. Il mockup usa lo stesso **Utente demo** per richiedere e decidere: non implementa autorizzazioni ERP.
- Il budget inviato è consultabile: **Ritira** lo riporta in bozza; **Respingi** richiede una motivazione e **Riapri bozza** consente le correzioni.
- **Approva e rendi ufficiale** congela il budget iniziale e crea la revisione 0. Esiste una sola versione ufficiale per nome budget, anno, struttura analitica e tipo. L'approvazione di una nuova versione disattiva la precedente, conservandola.
- Le versioni approvate e le richieste concluse non si modificano né si eliminano. Una correzione passa da una nuova rettifica, anche con segno negativo per stornare una variazione precedente. Le revisioni conservano la pianificazione completa, inclusi gli anni degli investimenti, autore, data e richiesta collegata.
- **Copia** genera una nuova bozza disattiva, con numero di versione successivo e revisione 0. Consolida una sola volta le rettifiche approvate e rigenera gli identificativi dei livelli e i collegamenti padre/figlio. Richieste in bozza/pendenti e storico restano sulla versione di origine.
- La barra compatta sopra i filtri mostra **Versione**, **Revisione**, stato e indicazione **Versione ufficiale**, con i relativi comandi. Non sono presenti KPI a riquadri. Sotto la tabella 3, lo storico è affiancato in due pannelli: **Revisioni approvate** su tre quarti della larghezza e **Iter del budget** su un quarto; su schermi stretti i pannelli si dispongono in verticale. Nelle revisioni le celle e i totali annuali cambiati rispetto alla revisione precedente sono verdi per gli aumenti e rossi per le diminuzioni, con differenza firmata e valori prima/dopo nel suggerimento; la revisione iniziale resta neutra. Nella vista mensile normale di un budget approvato vengono mostrati i valori aggiornati; la vista Rettifica distingue valori iniziali e variazioni.
- I dati precedenti vengono conservati e caricati come bozze: un vecchio flag `Attivo` non equivale a un'approvazione. Anno e tipo si scelgono alla creazione, mentre versione e revisione sono gestite dal sistema.
- Lo stato completo, comprese revisioni e richieste, è salvato in `data/budget_mockup.db`. `budget_wingest.db` resta la proiezione SQL legacy e non rappresenta il nuovo workflow né tutta la pianificazione gerarchica.
- Se due schede modificano lo stesso stato, il server rifiuta una scrittura obsoleta e chiede di ricaricare. I salvataggi della stessa scheda vengono eseguiti in ordine. Un errore della proiezione SQL non conferma né sostituisce lo stato autorevole.

Per usare questa versione, avvia (o riavvia se era già in esecuzione) `start.bat` e apri `http://127.0.0.1:8793`. Con la sola apertura di `index.html`, il salvataggio resta nel browser ed è segnalato esplicitamente.

### Verifica funzionale

1. Crea o copia un budget; modifica l'intestazione e i livelli. Salva anche una bozza non quadrata e verifica che l'invio sia bloccato.
2. Completa le quadrature, invia, prova ritiro/rifiuto e infine approva. Controlla revisione 0 e protezione dei dati.
3. In Rettifica modifica una o più celle, salva una bozza, riaprila e modifica la proposta; inviala, ritirala e inviala nuovamente.
4. Approva la richiesta: controlla riepiloghi, livelli superiori e nuova revisione. Prova anche un rifiuto motivato e uno storno.
5. Copia la versione aggiornata e approva la copia: deve restare un solo ufficiale e la nuova base deve includere le rettifiche una sola volta.
6. Ricarica la pagina e verifica permanenza di valori, richieste, motivazioni e revisioni. Elimina solo bozze di prova tramite la conferma nella pagina.

Test automatici (Node.js e Python):

```powershell
node --test tests/*.test.mjs
python -m unittest discover -s tests -p 'test_*.py' -v
```

I test di persistenza usano database temporanei e non modificano i dati di lavoro.

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
