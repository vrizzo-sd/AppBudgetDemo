# Decisioni da validare prima dello sviluppo definitivo

Aggiornamento: 25/09/2026.

Le seguenti decisioni non sono dettagli che il programmatore dovrebbe scegliere autonomamente. Ogni risposta può modificare modello dati, servizi, schermate o stima.

| ID | Decisione | Situazione attuale | Impatto |
| --- | --- | --- | --- |
| D-01 | Quali oggetti Wingest rappresentano budget, CDC/livelli e commesse CAPEX? | Il mockup usa identificativi propri e lo schema SQLite è solo dimostrativo. | Mapping dati, chiavi esterne, servizi e permessi. |
| D-02 | La struttura analitica resta a un solo livello o deve supportare una gerarchia? | La UI corrente lavora con un solo livello; l'architettura propone un eventuale `parent_level_id`. | Modello, navigazione, riepiloghi e controlli di unicità. |
| D-03 | Qual è la chiave univoca del budget? | La proposta usa anno, nome/codice e versione, ma il codice budget non è esposto uniformemente nel mockup. | Vincoli DB, creazione, ricerca e migrazione. |
| D-04 | Come funzionano versione, revisione e stati del budget? | Sono campi modificabili senza un ciclo di vita formalizzato. | Workflow, modificabilità, storico e audit. |
| D-05 | Chi può redigere, inviare, approvare, respingere e riaprire? | Il demo non ha utenti o ruoli. | Autorizzazioni backend, UI e audit. |
| D-06 | Quali stati e passaggi sono previsti per rettifiche e CAPEX? | Sono presenti Bozza, In approvazione, Approvata e altri stati di voce, ma manca una macchina a stati unica. | Regole di transizione, notifiche e totali ufficiali. |
| D-07 | Quali sottoconti sono ammessi per ordinario e investimento? | Il demo accetta testo e controlla solo conflitti interni. | Integrazione piano dei conti e validazione contabile. |
| D-08 | La fonte di finanziamento del livello è manuale o calcolata dalle voci? | Il mockup conserva entrambi i valori e può mostrare “Fonti miste”. | Ridondanza dati, modifica e riconciliazione. |
| D-09 | Qual è la regola definitiva quando cambia il CAPEX totale? | Il mockup ridimensiona proporzionalmente il calendario base della voce collegata. | Rettifiche, tracciabilità e distribuzione mensile. |
| D-10 | Come gestire finanziamento parziale, anticipo, spese e contributi? | Il demo considera finanziamento completo e tasso fisso. | Modello pagamenti e copertura finanziaria. |
| D-11 | Quale regola di ammortamento usare e quale integrazione con i cespiti? | Il calcolo lineare è esplicitamente una stima demo. | Calcoli contabili e responsabilità del modulo. |
| D-12 | È previsto il caricamento di consuntivi, impegni e scostamenti? | Non è incluso nella specifica corrente. | Perimetro, fonti dati e nuove schermate. |
| D-13 | Quali filtri devono essere realmente operativi? | Data, esercizio e versione sono visibili; il codice applica solo struttura e stato nell'elenco. | Query backend e UX. |
| D-14 | È ammessa la cancellazione e in quali stati? | Non è definita; la proposta vieta la cancellazione fisica degli approvati. | Audit, vincoli referenziali e UI. |
| D-15 | Quale modulo/stack Wingest ospiterà la funzione? | Il mockup non impone lo stack e il checkout corrente non contiene il codice Wingest applicativo. | Stima tecnica, componenti riusabili, integrazione e deployment. |

## Decisioni bloccanti per la prima implementazione

Prima di rendere definitivo il modello dati devono essere chiuse almeno D-01, D-02, D-03 e D-04. Prima del workflow di rettifica servono D-05 e D-06. Prima del CAPEX produttivo servono D-07, D-08, D-09 e D-11.

Le attività di analisi tecnica e il prototipo verticale possono iniziare anche con alcune decisioni aperte, purché le assunzioni siano dichiarate e non vengano trasformate in vincoli irreversibili.
