import React, { useEffect, useMemo, useState } from 'react';

const emptyCard = {
  de_name: '',
  passcode: '',
  en_name: ''
};

const menuItems = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'decks', label: 'Decks' },
  { id: 'scanner', label: 'Scanner' },
  { id: 'duplicates', label: 'Duplicates' },
  { id: 'jobs', label: 'Jobs' },
  { id: 'settings', label: 'Settings' },
  { id: 'logs', label: 'Logs' }
];

function App() {
  const [cards, setCards] = useState([]);
  const [selectedIds, setSelectedIds] = useState([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [missingOnly, setMissingOnly] = useState(false);
  const [activeCard, setActiveCard] = useState(null);
  const [activeCardDirty, setActiveCardDirty] = useState(false);
  const [logs, setLogs] = useState([]);
  const [job, setJob] = useState(null);
  const [busy, setBusy] = useState(false);
  const [busyMessage, setBusyMessage] = useState('');
  const [settings, setSettings] = useState({});
  const [duplicates, setDuplicates] = useState([]);
  const [activeMenu, setActiveMenu] = useState('dashboard');
  const [decks, setDecks] = useState([]);
  const [deckUrl, setDeckUrl] = useState('');
  const [activeDeck, setActiveDeck] = useState(null);
  const [lastImport, setLastImport] = useState(null);
  const [sortKey, setSortKey] = useState('updated_at');
  const [sortDir, setSortDir] = useState('desc');
  const [scanResults, setScanResults] = useState([]);
  const [scanSummary, setScanSummary] = useState(null);
  const [speechTranscript, setSpeechTranscript] = useState('');
  const [speechBusy, setSpeechBusy] = useState(false);
  const [speechStatus, setSpeechStatus] = useState('');
  const [speechReview, setSpeechReview] = useState(null);
  const [speechSelections, setSpeechSelections] = useState({});
  const [duplicateNotice, setDuplicateNotice] = useState(null);

  const loadCards = async () => {
    const result = await window.api.listCards({
      search,
      status: statusFilter,
      missingDetails: missingOnly
    });
    setCards(result);
  };

  const loadLogs = async () => {
    const result = await window.api.listLogs();
    setLogs(result);
  };

  const loadSettings = async () => {
    const result = await window.api.getSettings();
    setSettings(result);
  };

  const loadDuplicates = async () => {
    const result = await window.api.listDuplicates();
    setDuplicates(result);
  };

  const loadDecks = async () => {
    const result = await window.api.listDecks();
    setDecks(result);
  };

  const loadLastImport = async () => {
    const result = await window.api.getLastImportBatch();
    setLastImport(result);
  };

  useEffect(() => {
    loadCards();
  }, [search, statusFilter, missingOnly]);

  useEffect(() => {
    if (!activeCard || activeCardDirty) return;
    const updated = cards.find((card) => card.id === activeCard.id);
    if (updated) {
      setActiveCard(updated);
    }
  }, [cards, activeCard, activeCardDirty]);

  useEffect(() => {
    loadLogs();
    loadSettings();
    loadDuplicates();
    loadDecks();
    loadLastImport();
  }, []);

  useEffect(() => {
    let timer;
    if (job?.id && job?.status === 'RUNNING') {
      timer = setInterval(() => {
        refreshJob();
      }, 1500);
    }
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [job?.id, job?.status]);

  const runWithBusy = async (message, action) => {
    setBusy(true);
    setBusyMessage(message);
    try {
      return await action();
    } finally {
      setBusy(false);
      setBusyMessage('');
    }
  };

  const showDuplicateNotice = (source, items) => {
    if (!items || items.length === 0) return;
    setDuplicateNotice({ source, items });
  };

  const handleSort = (key) => {
    if (sortKey === key) {
      setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  const handleSelect = (id) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((value) => value !== id) : [...prev, id]
    );
  };

  const handleUpsert = async (card) => {
    const id = await window.api.upsertCard(card);
    await loadCards();
    return id;
  };

  const handleDelete = async (id) => {
    await window.api.deleteCard(id);
    if (activeCard?.id === id) {
      setActiveCard(null);
      setActiveCardDirty(false);
    }
    await loadCards();
  };

  const handleSaveCard = async () => {
    if (!activeCardDetails) return;
    await runWithBusy('Speichere Karte…', async () => {
      const id = await handleUpsert(activeCardDetails);
      const payload = { ...activeCardDetails, id };
      await window.api.updateCardDetails(payload);
      setActiveCard(payload);
      setActiveCardDirty(false);
    });
  };

  const handleImport = async () => {
    await runWithBusy('Importiere CSV…', async () => {
      const fileResult = await window.api.importCsvFile();
      if (fileResult?.canceled) return;
      const rows = parseCsv(fileResult.content || '');
      const result = await window.api.importCsv({ rows, source: 'csv' });
      showDuplicateNotice('CSV-Import', result?.duplicates || []);
      if (result?.batchId) {
        await loadLastImport();
      }
      await loadCards();
    });
  };

  const handleExport = async () => {
    await runWithBusy('Exportiere CSV…', async () => {
      const data = await window.api.exportCsv();
      const csv = toCsv(data);
      await navigator.clipboard.writeText(csv);
      alert('CSV wurde in die Zwischenablage kopiert.');
    });
  };

  const handlePasteNames = async () => {
    const input = prompt('Kartennamen zeilenweise einfügen');
    if (!input) return;
    const lines = input.split('\n');
    await runWithBusy('Füge Karten ein…', async () => {
      const result = await window.api.pasteCards({ lines });
      showDuplicateNotice('Einfügen', result?.duplicates || []);
      if (result?.batchId) {
        await loadLastImport();
      }
      await loadCards();
    });
  };

  const handleFetchMissing = async () => {
    await runWithBusy('Starte Fetch missing…', async () => {
      const jobId = await window.api.startFetchMissingDetails();
      setJob({ id: jobId, status: 'RUNNING' });
    });
  };

  const handleFetchSelected = async () => {
    if (selectedIds.length === 0) return;
    await runWithBusy('Starte Fetch selected…', async () => {
      const jobId = await window.api.startFetchSelectedDetails(selectedIds);
      setJob({ id: jobId, status: 'RUNNING' });
    });
  };

  const handleFetchSingle = async (id) => {
    await runWithBusy('Starte Fetch…', async () => {
      const jobId = await window.api.startFetchSelectedDetails([id]);
      setJob({ id: jobId, status: 'RUNNING' });
    });
  };

  const handleClearDetails = async (id) => {
    await runWithBusy('Entferne Details…', async () => {
      await window.api.clearDetails(id);
      await loadCards();
    });
  };

  const refreshJob = async () => {
    if (!job?.id) return;
    const status = await window.api.getJobStatus(job.id);
    setJob(status);
  };

  const handlePauseJob = async () => {
    await window.api.pauseJob(job.id);
    await refreshJob();
  };

  const handleResumeJob = async () => {
    await window.api.resumeJob(job.id);
    await refreshJob();
  };

  const handleCancelJob = async () => {
    await window.api.cancelJob(job.id);
    await refreshJob();
  };

  const handleSaveSettings = async () => {
    await runWithBusy('Speichere Settings…', async () => {
      await window.api.saveSettings(settings);
      await loadSettings();
    });
  };

  const handleImportDeck = async () => {
    if (!deckUrl) return;
    await runWithBusy('Importiere Deck…', async () => {
      const result = await window.api.importDeckFromUrl({ url: deckUrl });
      setDeckUrl('');
      await loadDecks();
      if (result?.deckId) {
        const deckDetails = await window.api.getDeck(result.deckId);
        setActiveDeck(deckDetails);
      }
    });
  };

  const handleSelectDeck = async (deckId) => {
    const deckDetails = await window.api.getDeck(deckId);
    setActiveDeck(deckDetails);
  };

  const handleDeleteDeck = async (deckId) => {
    await runWithBusy('Lösche Deck…', async () => {
      await window.api.deleteDeck(deckId);
      if (activeDeck?.deck?.id === deckId) setActiveDeck(null);
      await loadDecks();
    });
  };

  const activeCardDetails = useMemo(() => {
    if (!activeCard) return null;
    if (activeCardDirty) return activeCard;
    return cards.find((card) => card.id === activeCard.id) || activeCard;
  }, [activeCard, activeCardDirty, cards]);

  const sortedCards = useMemo(() => {
    const data = [...cards];
    const direction = sortDir === 'asc' ? 1 : -1;
    data.sort((a, b) => {
      const valueA = normalizeSortValue(a[sortKey]);
      const valueB = normalizeSortValue(b[sortKey]);
      if (valueA < valueB) return -1 * direction;
      if (valueA > valueB) return 1 * direction;
      return 0;
    });
    return data;
  }, [cards, sortDir, sortKey]);

  const deckStats = useMemo(() => {
    if (!activeDeck?.entries) return null;
    const total = activeDeck.entries.reduce((sum, entry) => sum + entry.quantity, 0);
    const owned = activeDeck.entries.reduce((sum, entry) => sum + (entry.owned ? entry.quantity : 0), 0);
    return { total, owned, missing: total - owned };
  }, [activeDeck]);

  const handleSelectLastImport = async () => {
    if (!lastImport?.id) return;
    await runWithBusy('Wähle Import aus…', async () => {
      const rows = await window.api.listCardsByImportBatch(lastImport.id);
      const ids = rows.map((row) => row.id);
      setSelectedIds(ids);
    });
  };

  const handleDeleteSelected = async () => {
    if (selectedIds.length === 0) return;
    await runWithBusy('Lösche Auswahl…', async () => {
      await window.api.deleteCards(selectedIds);
      if (activeCard && selectedIds.includes(activeCard.id)) {
        setActiveCard(null);
      }
      setSelectedIds([]);
      await loadCards();
    });
  };

  const handleFetchAll = async () => {
    await runWithBusy('Starte Fetch all…', async () => {
      const jobId = await window.api.startFetchAllDetails();
      setJob({ id: jobId, status: 'RUNNING' });
    });
  };

  const handleSelectVisible = () => {
    const ids = sortedCards.map((card) => card.id);
    setSelectedIds(ids);
  };

  const handleDeselectAll = () => {
    setSelectedIds([]);
  };


  const handleTranscribeAudio = async () => {
    setSpeechBusy(true);
    setSpeechStatus('Transcribing audio…');
    setSpeechReview(null);
    setSpeechSelections({});
    try {
      const result = await window.api.transcribeAudio();
      if (result?.canceled) {
        setSpeechStatus('');
        return;
      }
      if (result?.error) {
        setSpeechStatus(`Transcription failed: ${result.error}`);
        return;
      }
      const candidates = result?.candidates || [];
      setSpeechTranscript(result.transcript || '');
      setScanResults(candidates);
      setScanSummary({ totalImages: 0, totalResults: candidates.length });
      setSpeechReview({ candidates, duplicates: result?.duplicates || [] });
      const initialSelections = {};
      candidates.forEach((_, index) => {
        initialSelections[index] = true;
      });
      setSpeechSelections(initialSelections);
      setSpeechStatus('Transcription complete. Review results below.');
    } catch (error) {
      setSpeechStatus(`Transcription failed: ${error.message}`);
    } finally {
      setSpeechBusy(false);
    }
  };

  const toggleSpeechSelection = (index) => {
    setSpeechSelections((prev) => ({ ...prev, [index]: !prev[index] }));
  };

  const selectAllSpeech = () => {
    if (!speechReview?.candidates) return;
    const selections = {};
    speechReview.candidates.forEach((_, index) => {
      selections[index] = true;
    });
    setSpeechSelections(selections);
  };

  const deselectAllSpeech = () => {
    setSpeechSelections({});
  };

  const handleAddSpeechSelections = async () => {
    if (!speechReview?.candidates) return;
    const selected = speechReview.candidates
      .filter((_, index) => speechSelections[index])
      .map((entry) => entry.incoming);
    if (selected.length === 0) {
      setSpeechStatus('No cards selected for import.');
      return;
    }
    await runWithBusy('Speichere Sprach-Import…', async () => {
      const result = await window.api.addTranscribedCards({ candidates: selected });
      setSpeechStatus(`Added ${result.added} card(s), merged ${result.merged} duplicate(s).`);
      setSpeechReview(null);
      setSpeechSelections({});
      await loadCards();
      if (result?.duplicates?.length) {
        showDuplicateNotice('Sprach-Import', result.duplicates);
      }
    });
  };

  const activeJobMessage = useMemo(() => {
    if (job?.status !== 'RUNNING') return '';
    if (job?.current_action) return job.current_action;
    if (job?.current_card_id) return `Fetching card #${job.current_card_id}`;
    return 'Fetching cards…';
  }, [job]);

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="sidebar__brand">
          <span className="brand__dot" />
          <div>
            <h1>YGO Card Manager</h1>
            <p>Cardcluster + 4 weitere Quellen</p>
          </div>
        </div>
        <nav className="sidebar__nav">
          {menuItems.map((item) => (
            <button
              key={item.id}
              className={activeMenu === item.id ? 'nav-item nav-item--active' : 'nav-item'}
              onClick={() => setActiveMenu(item.id)}
            >
              {item.label}
            </button>
          ))}
        </nav>
        <div className="sidebar__footer">v0.1 · Dark mode</div>
      </aside>

      <div className="content">
        <header className="topbar">
          <div>
            <h2>{menuItems.find((item) => item.id === activeMenu)?.label}</h2>
            <p>Manage your Yu-Gi-Oh inventory locally.</p>
          </div>
          <div className="topbar__actions">
            {(busy || job?.status === 'RUNNING') && (
              <div className="busy-indicator">
                <span className="spinner" />
                <span>{busyMessage || activeJobMessage || 'Arbeite…'}</span>
              </div>
            )}
            <button className="ghost" onClick={loadCards}>Refresh</button>
            <button className="primary" onClick={() => handleUpsert(emptyCard)}>Add Card</button>
          </div>
        </header>

        {activeMenu === 'dashboard' && (
          <section className="panel fade-in">
            <div className="panel__header">
              <h3>Inventory</h3>
            </div>

            <section className="filters">
              <div className="filters__row">
                <input
                  placeholder="Search name or passcode"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
                <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
                  <option value="">All statuses</option>
                  <option value="OK_DETAILS">OK_DETAILS</option>
                  <option value="NOT_FOUND">NOT_FOUND</option>
                  <option value="ERROR">ERROR</option>
                  <option value="SKIP_DETAILS_PRESENT">SKIP_DETAILS_PRESENT</option>
                  <option value="NEED_INPUT">NEED_INPUT</option>
                  <option value="WARNING_PASSCODE_MISMATCH">WARNING_PASSCODE_MISMATCH</option>
                </select>
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={missingOnly}
                    onChange={(event) => setMissingOnly(event.target.checked)}
                  />
                  Missing details
                </label>
              </div>
              <div className="filters__row filters__row--actions">
                <div className="action-group">
                  <span className="action-label">Import</span>
                  <button onClick={handleImport}>Import CSV</button>
                  <button onClick={handleExport}>Export CSV</button>
                  <button onClick={handlePasteNames}>Paste Names</button>
                </div>
                <div className="action-group">
                  <span className="action-label">Fetch</span>
                  <button onClick={handleFetchAll}>Fetch all</button>
                  <button onClick={handleFetchMissing}>Fetch missing</button>
                  <button onClick={handleFetchSelected} disabled={selectedIds.length === 0}>
                    Fetch selected
                  </button>
                </div>
                <div className="action-group">
                  <span className="action-label">Selection</span>
                  <button onClick={handleSelectLastImport} disabled={!lastImport?.id}>
                    Select last import
                  </button>
                  {selectedIds.length > 0 && (
                    <button className="ghost" onClick={handleDeleteSelected}>
                      Delete selected
                    </button>
                  )}
                  {selectedIds.length > 0 && (
                    <button className="ghost" onClick={handleSelectVisible}>
                      Select all shown
                    </button>
                  )}
                  {selectedIds.length > 0 && (
                    <button className="ghost" onClick={handleDeselectAll}>
                      Deselect all
                    </button>
                  )}
                  {lastImport?.id && (
                    <span className="import-hint">
                      Batch #{lastImport.id} · {lastImport.count || 0} Karten
                    </span>
                  )}
                </div>
              </div>
            </section>

            {job?.status === 'RUNNING' && (
              <div className="job-inline">
                <span>{activeJobMessage}</span>
                <span>
                  {job.done || 0}/{job.total || 0}
                </span>
                <progress value={job.done || 0} max={job.total || 1} />
              </div>
            )}

            <main className="app__main">
              <section className="table-section">
                <table>
                  <thead>
                    <tr>
                      <th></th>
                      <th>
                        <button className="sort-button" onClick={() => handleSort('de_name')}>
                          DE {renderSortIndicator(sortKey, sortDir, 'de_name')}
                        </button>
                      </th>
                      <th>
                        <button className="sort-button" onClick={() => handleSort('passcode')}>
                          Passcode {renderSortIndicator(sortKey, sortDir, 'passcode')}
                        </button>
                      </th>
                      <th>
                        <button className="sort-button" onClick={() => handleSort('en_name')}>
                          EN {renderSortIndicator(sortKey, sortDir, 'en_name')}
                        </button>
                      </th>
                      <th>
                        <button className="sort-button" onClick={() => handleSort('status')}>
                          Status {renderSortIndicator(sortKey, sortDir, 'status')}
                        </button>
                      </th>
                      <th>
                        <button className="sort-button" onClick={() => handleSort('last_fetched_at')}>
                          Last fetched {renderSortIndicator(sortKey, sortDir, 'last_fetched_at')}
                        </button>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedCards.map((card) => (
                      <tr
                        key={card.id}
                        onClick={() => {
                          setActiveCard(card);
                          setActiveCardDirty(false);
                        }}
                      >
                        <td>
                          <input
                            type="checkbox"
                            checked={selectedIds.includes(card.id)}
                            onChange={() => handleSelect(card.id)}
                          />
                        </td>
                        <td>{card.de_name}</td>
                        <td>{card.passcode}</td>
                        <td>{card.en_name}</td>
                        <td>
                          <span className={`status-pill status-pill--${card.status || 'UNKNOWN'}`}>
                            {card.status || 'UNKNOWN'}
                          </span>
                        </td>
                        <td>{card.last_fetched_at}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>

              <section className="detail-section">
                <h2>Detail</h2>
                {activeCardDetails ? (
                  <div className="detail-card fade-in">
                    <label>
                      DE Name
                      <input
                        value={activeCardDetails.de_name || ''}
                        onChange={(event) => {
                          setActiveCard({ ...activeCardDetails, de_name: event.target.value });
                          setActiveCardDirty(true);
                        }}
                      />
                    </label>
                    <label>
                      Passcode
                      <input
                        value={activeCardDetails.passcode || ''}
                        onChange={(event) => {
                          setActiveCard({ ...activeCardDetails, passcode: event.target.value });
                          setActiveCardDirty(true);
                        }}
                      />
                    </label>
                    <label>
                      EN Name
                      <input
                        value={activeCardDetails.en_name || ''}
                        onChange={(event) => {
                          setActiveCard({ ...activeCardDetails, en_name: event.target.value });
                          setActiveCardDirty(true);
                        }}
                      />
                    </label>

                    <div className="detail-actions">
                      <button className="primary" onClick={handleSaveCard}>Save</button>
                      <button className="ghost" onClick={() => handleDelete(activeCardDetails.id)}>Delete</button>
                      <button onClick={() => handleFetchSingle(activeCardDetails.id)}>Details neu laden</button>
                      <button onClick={() => handleClearDetails(activeCardDetails.id)}>Clear details</button>
                    </div>

                    <div className="detail-fields">
                      <p>Status: {activeCardDetails.status}</p>
                      <label>
                        Source
                        <input
                          value={activeCardDetails.data_source || ''}
                          onChange={(event) => {
                            setActiveCard({ ...activeCardDetails, data_source: event.target.value });
                            setActiveCardDirty(true);
                          }}
                        />
                      </label>
                      <label>
                        Cardcluster URL
                        <input
                          value={activeCardDetails.cardcluster_url || ''}
                          onChange={(event) => {
                            setActiveCard({ ...activeCardDetails, cardcluster_url: event.target.value });
                            setActiveCardDirty(true);
                          }}
                        />
                      </label>
                      <label>
                        Source URL
                        <input
                          value={activeCardDetails.source_url || ''}
                          onChange={(event) => {
                            setActiveCard({ ...activeCardDetails, source_url: event.target.value });
                            setActiveCardDirty(true);
                          }}
                        />
                      </label>
                      <label>
                        Kind
                        <input
                          value={activeCardDetails.card_kind || ''}
                          onChange={(event) => {
                            setActiveCard({ ...activeCardDetails, card_kind: event.target.value });
                            setActiveCardDirty(true);
                          }}
                        />
                      </label>
                      <label>
                        Subtypes
                        <input
                          value={activeCardDetails.card_subtypes || ''}
                          onChange={(event) => {
                            setActiveCard({ ...activeCardDetails, card_subtypes: event.target.value });
                            setActiveCardDirty(true);
                          }}
                        />
                      </label>
                      <label>
                        Attribute
                        <input
                          value={activeCardDetails.attribute || ''}
                          onChange={(event) => {
                            setActiveCard({ ...activeCardDetails, attribute: event.target.value });
                            setActiveCardDirty(true);
                          }}
                        />
                      </label>
                      <label>
                        Level/Rank
                        <input
                          type="number"
                          value={activeCardDetails.level_or_rank ?? ''}
                          onChange={(event) => {
                            setActiveCard({ ...activeCardDetails, level_or_rank: event.target.value });
                            setActiveCardDirty(true);
                          }}
                        />
                      </label>
                      <label>
                        Link Rating
                        <input
                          type="number"
                          value={activeCardDetails.link_rating ?? ''}
                          onChange={(event) => {
                            setActiveCard({ ...activeCardDetails, link_rating: event.target.value });
                            setActiveCardDirty(true);
                          }}
                        />
                      </label>
                      <label>
                        Race
                        <input
                          value={activeCardDetails.race || ''}
                          onChange={(event) => {
                            setActiveCard({ ...activeCardDetails, race: event.target.value });
                            setActiveCardDirty(true);
                          }}
                        />
                      </label>
                      <label>
                        ATK
                        <input
                          type="number"
                          value={activeCardDetails.atk ?? ''}
                          onChange={(event) => {
                            setActiveCard({ ...activeCardDetails, atk: event.target.value });
                            setActiveCardDirty(true);
                          }}
                        />
                      </label>
                      <label>
                        DEF
                        <input
                          type="number"
                          value={activeCardDetails.def ?? ''}
                          onChange={(event) => {
                            setActiveCard({ ...activeCardDetails, def: event.target.value });
                            setActiveCardDirty(true);
                          }}
                        />
                      </label>
                      <label>
                        Pendulum Scale
                        <input
                          type="number"
                          value={activeCardDetails.pendulum_scale ?? ''}
                          onChange={(event) => {
                            setActiveCard({ ...activeCardDetails, pendulum_scale: event.target.value });
                            setActiveCardDirty(true);
                          }}
                        />
                      </label>
                      <label>
                        Spell/Trap Property
                        <input
                          value={activeCardDetails.spell_trap_property || ''}
                          onChange={(event) => {
                            setActiveCard({ ...activeCardDetails, spell_trap_property: event.target.value });
                            setActiveCardDirty(true);
                          }}
                        />
                      </label>
                      <label>
                        Effect (EN)
                        <textarea
                          rows={6}
                          value={activeCardDetails.effect_text_en || ''}
                          onChange={(event) => {
                            setActiveCard({ ...activeCardDetails, effect_text_en: event.target.value });
                            setActiveCardDirty(true);
                          }}
                        />
                      </label>
                    </div>
                  </div>
                ) : (
                  <p>Select a card to view details.</p>
                )}
              </section>
            </main>
          </section>
        )}

        {activeMenu === 'decks' && (
          <section className="panel fade-in">
            <div className="panel__header">
              <h3>Deck Import</h3>
              <div className="panel__actions">
                <input
                  className="deck-url"
                  placeholder="Cardcluster Deck URL"
                  value={deckUrl}
                  onChange={(event) => setDeckUrl(event.target.value)}
                />
                <button className="primary" onClick={handleImportDeck}>Import Deck</button>
              </div>
            </div>

            <div className="deck-grid">
              <div className="deck-list">
                <h4>Decks</h4>
                {decks.length === 0 ? (
                  <p>No decks imported yet.</p>
                ) : (
                  <ul>
                    {decks.map((deck) => (
                      <li key={deck.id} className={activeDeck?.deck?.id === deck.id ? 'deck-item active' : 'deck-item'}>
                        <button onClick={() => handleSelectDeck(deck.id)}>{deck.name}</button>
                        <span>{deck.total_cards} cards</span>
                        <button className="ghost" onClick={() => handleDeleteDeck(deck.id)}>Delete</button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="deck-details">
                {activeDeck ? (
                  <div>
                    <div className="deck-header">
                      <div>
                        <h4>{activeDeck.deck.name}</h4>
                        <p>{activeDeck.deck.cardcluster_url}</p>
                      </div>
                      {deckStats && (
                        <div className="deck-stats">
                          <span className="status-pill status-pill--OK_DETAILS">Owned {deckStats.owned}</span>
                          <span className="status-pill status-pill--NOT_FOUND">Missing {deckStats.missing}</span>
                          <span className="status-pill">Total {deckStats.total}</span>
                        </div>
                      )}
                    </div>
                    <table className="deck-table">
                      <thead>
                        <tr>
                          <th>Card</th>
                          <th>Passcode</th>
                          <th>Qty</th>
                          <th>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {activeDeck.entries.map((entry) => (
                          <tr key={entry.id} className={entry.owned ? 'owned' : 'missing'}>
                            <td>{entry.card_name}</td>
                            <td>{entry.passcode}</td>
                            <td>{entry.quantity}</td>
                            <td>
                              <span className={`status-pill ${entry.owned ? 'status-pill--OK_DETAILS' : 'status-pill--NOT_FOUND'}`}>
                                {entry.owned ? 'Owned' : 'Missing'}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p>Select a deck to view details.</p>
                )}
              </div>
            </div>
          </section>
        )}

        {activeMenu === 'scanner' && (
          <section className="panel fade-in">
            <div className="panel__header">
              <h3>Sprach-Scanner</h3>
              <div className="panel__actions">
                <button className="primary" onClick={handleTranscribeAudio} disabled={speechBusy}>
                  {speechBusy ? 'Transcribing…' : 'Record & Transcribe'}
                </button>
              </div>
            </div>
            {scanSummary && (
              <div className="scan-summary">
                <span>Cards found: {scanSummary.totalResults}</span>
              </div>
            )}
            {speechStatus && (
              <div className="scan-summary">
                <span>{speechStatus}</span>
              </div>
            )}
            {speechTranscript && (
              <div className="scan-results">
                <h4>Transcript</h4>
                <p>{speechTranscript}</p>
              </div>
            )}
            <p className="scanner-note">
              Sprach-Transkription läuft über ein KI-Modell (OpenAI Speech-to-Text) und verarbeitet
              die genannten Kartennamen automatisch. Nach der Transkription kannst du auswählen,
              welche Karten gespeichert werden.
            </p>
            <div className="algorithm">
              <p>
                Ziel: Du sprichst mehrere Kartennamen ein, die KI transkribiert sie, sucht Passcodes und
                englische Namen online und speichert die Ergebnisse in der Datenbank.
              </p>
              <ol>
                <li>
                  <strong>Audio-Input & Transkription</strong>
                  <ul>
                    <li>Audio aufnehmen oder Datei hochladen (z. B. WAV, MP3, M4A).</li>
                    <li>Transkription via OpenAI Speech-to-Text (de/eng gemischt möglich).</li>
                    <li>Segmentierung in einzelne Kartennamen (Kommas/Pausen).</li>
                  </ul>
                </li>
                <li>
                  <strong>Namens-Normalisierung</strong>
                  <ul>
                    <li>Trimmen, Sonderzeichen bereinigen, doppelte Leerzeichen entfernen.</li>
                    <li>Optional: GPT-basiertes Post-Processing für besonders unsaubere Transkripte.</li>
                  </ul>
                </li>
                <li>
                  <strong>Online-Suche (sequenziell pro Datenbank)</strong>
                  <ul>
                    <li><em>Quelle 1: Cardcluster</em> – Suche per Name, HTML-Scan, Detailseite parsen.</li>
                    <li><em>Quelle 2: YGOPRODeck</em> – HTML-Suche → API-Fallback.</li>
                    <li>Falls keine Quelle matcht: status=NOT_FOUND.</li>
                  </ul>
                </li>
                <li>
                  <strong>Validierung</strong>
                  <ul>
                    <li>Gefundene Passcodes prüfen, englische Namen übernehmen.</li>
                    <li>Abweichungen loggen und in der Detailansicht korrigierbar machen.</li>
                  </ul>
                </li>
                <li>
                  <strong>Datenbank-Insert</strong>
                  <ul>
                    <li>Duplikate prüfen (passcode/en_name/de_name).</li>
                    <li>Neue Karten hinzufügen, bestehende via Merge-Logik aktualisieren.</li>
                  </ul>
                </li>
                <li>
                  <strong>Job-Status & Logging</strong>
                  <ul>
                    <li>Pro Karte Fortschritt loggen (Speech → Suche → Detail → Insert).</li>
                    <li>UI zeigt Fortschritt (done/total) und aktuelle Karte.</li>
                    <li>Fehler: error_message speichern, raw_url (falls vorhanden) hinterlegen.</li>
                  </ul>
                </li>
                <li>
                  <strong>Qualitätssicherung</strong>
                  <ul>
                    <li>Konfidenz-Score je Karte speichern (Speech + Matching).</li>
                    <li>Unter einem Threshold: status=NEED_INPUT setzen und Review anfordern.</li>
                  </ul>
                </li>
              </ol>
              <p className="algorithm__note">
                Hinweis: Die Speech-to-Text Parameter und das Matching sind absichtlich getrennt,
                damit du sie im Settings-Tab feinjustieren kannst.
              </p>
            </div>
          </section>
        )}

        {activeMenu === 'duplicates' && (
          <section className="panel fade-in">
            <div className="panel__header">
              <h3>Duplicates</h3>
              <button onClick={loadDuplicates}>Refresh list</button>
            </div>
            {duplicates.length === 0 ? (
              <p>No duplicates found.</p>
            ) : (
              duplicates.map((group, idx) => (
                <div key={idx} className="duplicate-group">
                  <p>Group {idx + 1}</p>
                  <ul>
                    {group.map((card) => (
                      <li key={card.id}>
                        #{card.id} {card.de_name} / {card.en_name} ({card.passcode})
                        {group[0].id !== card.id && (
                          <button
                            onClick={async () => {
                              await window.api.mergeDuplicate({ keepId: group[0].id, mergeId: card.id });
                              await loadCards();
                              await loadDuplicates();
                            }}
                          >
                            Merge into #{group[0].id}
                          </button>
                        )}
                        <button
                          className="ghost"
                          onClick={async () => {
                            await window.api.ignoreDuplicate(card.id);
                            await loadDuplicates();
                          }}
                        >
                          Ignore
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ))
            )}
          </section>
        )}

        {activeMenu === 'jobs' && (
          <section className="panel fade-in">
            <div className="panel__header">
              <h3>Job Status</h3>
              <button onClick={refreshJob}>Refresh</button>
            </div>
            {job ? (
              <div>
                <p>Job #{job.id}</p>
                <p>Status: {job.status}</p>
                <p>
                  Progress: {job.done}/{job.total}
                </p>
                <progress value={job.done || 0} max={job.total || 1} />
                <p>Last error: {job.last_error}</p>
                <div className="job-actions">
                  <button onClick={handlePauseJob}>Pause</button>
                  <button onClick={handleResumeJob}>Resume</button>
                  <button onClick={handleCancelJob}>Cancel</button>
                </div>
              </div>
            ) : (
              <p>No active job.</p>
            )}
          </section>
        )}

        {activeMenu === 'settings' && (
          <section className="panel fade-in">
            <div className="panel__header">
              <h3>Settings</h3>
              <button className="primary" onClick={handleSaveSettings}>Save settings</button>
            </div>
            <div className="settings-grid">
              <label>
                batch_size
                <input
                  value={settings.batch_size || ''}
                  onChange={(event) => setSettings({ ...settings, batch_size: event.target.value })}
                />
              </label>
              <label>
                concurrency
                <input
                  value={settings.concurrency || ''}
                  onChange={(event) => setSettings({ ...settings, concurrency: event.target.value })}
                />
              </label>
              <label>
                request_delay_ms
                <input
                  value={settings.request_delay_ms || ''}
                  onChange={(event) => setSettings({ ...settings, request_delay_ms: event.target.value })}
                />
              </label>
              <label>
                user_agent
                <input
                  value={settings.user_agent || ''}
                  onChange={(event) => setSettings({ ...settings, user_agent: event.target.value })}
                />
              </label>
              <label>
                max_candidates_passcode_match
                <input
                  value={settings.max_candidates_passcode_match || ''}
                  onChange={(event) =>
                    setSettings({ ...settings, max_candidates_passcode_match: event.target.value })
                  }
                />
              </label>
              <label>
                openai_api_key
                <input
                  type="password"
                  value={settings.openai_api_key || ''}
                  onChange={(event) =>
                    setSettings({ ...settings, openai_api_key: event.target.value })
                  }
                />
              </label>
            </div>
          </section>
        )}

        {activeMenu === 'logs' && (
          <section className="panel fade-in">
            <div className="panel__header">
              <h3>Logs</h3>
              <button onClick={loadLogs}>Refresh</button>
            </div>
            <div className="log-panel">
              {logs.map((log) => (
                <div key={log.id}>
                  [{log.created_at}] {log.level}: {log.message}
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
      {speechReview && (
        <div className="modal-backdrop">
          <div className="modal modal--wide">
            <h3>Sprach-Transkription prüfen</h3>
            <p>
              {speechReview.candidates.length} Karte(n) erkannt. Wähle aus, welche Karten in die Datenbank
              übernommen werden sollen.
            </p>
            <div className="modal-actions modal-actions--inline">
              <button onClick={selectAllSpeech}>Alle auswählen</button>
              <button onClick={deselectAllSpeech}>Auswahl löschen</button>
            </div>
            <div className="modal-list modal-list--selectable">
              {speechReview.candidates.map((entry, index) => (
                <label key={`${entry.spoken}-${index}`} className="modal-row modal-row--selectable">
                  <input
                    type="checkbox"
                    checked={Boolean(speechSelections[index])}
                    onChange={() => toggleSpeechSelection(index)}
                  />
                  <div className="modal-row__content">
                    <div>
                      <strong>{entry.incoming?.en_name || entry.spoken}</strong>
                      {entry.incoming?.passcode ? ` • ${entry.incoming.passcode}` : ''}
                    </div>
                    <div className="muted">
                      Status: {entry.status}
                      {entry.duplicate ? ' • Duplicate' : ''}
                    </div>
                  </div>
                </label>
              ))}
            </div>
            {speechReview.duplicates?.length > 0 && (
              <div className="modal-duplicates">
                <h4>Duplikate gefunden</h4>
                <div className="modal-list">
                  {speechReview.duplicates.map((item, index) => (
                    <div key={`${item.existing?.id || 'speech-dup'}-${index}`} className="modal-row">
                      <div>
                        <strong>Neu:</strong>{' '}
                        {[item.incoming?.de_name, item.incoming?.en_name, item.incoming?.passcode]
                          .filter(Boolean)
                          .join(' • ') || '—'}
                      </div>
                      <div>
                        <strong>Bereits vorhanden:</strong>{' '}
                        {[item.existing?.de_name, item.existing?.en_name, item.existing?.passcode]
                          .filter(Boolean)
                          .join(' • ') || '—'}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div className="modal-actions">
              <button onClick={() => setSpeechReview(null)}>Abbrechen</button>
              <button className="primary" onClick={handleAddSpeechSelections}>
                Auswahl hinzufügen
              </button>
            </div>
          </div>
        </div>
      )}
      {duplicateNotice && (
        <div className="modal-backdrop">
          <div className="modal">
            <h3>Duplikate erkannt</h3>
            <p>
              Beim <strong>{duplicateNotice.source}</strong> wurden {duplicateNotice.items.length} Karte(n)
              übersprungen, weil sie bereits in der Datenbank vorhanden sind.
            </p>
            <div className="modal-list">
              {duplicateNotice.items.map((item, index) => (
                <div key={`${item.existing?.id || 'dup'}-${index}`} className="modal-row">
                  <div>
                    <strong>Neu:</strong>{' '}
                    {[item.incoming?.de_name, item.incoming?.en_name, item.incoming?.passcode]
                      .filter(Boolean)
                      .join(' • ') || '—'}
                  </div>
                  <div>
                    <strong>Bereits vorhanden:</strong>{' '}
                    {[item.existing?.de_name, item.existing?.en_name, item.existing?.passcode]
                      .filter(Boolean)
                      .join(' • ') || '—'}
                  </div>
                </div>
              ))}
            </div>
            <div className="modal-actions">
              <button className="primary" onClick={() => setDuplicateNotice(null)}>
                Verstanden
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function parseCsv(input) {
  const lines = input.trim().split(/\r?\n/);
  const header = lines.shift().split(',').map((item) => item.trim());
  return lines.map((line) => {
    const values = line.split(',');
    const row = {};
    header.forEach((key, idx) => {
      row[key] = values[idx] ? values[idx].trim() : '';
    });
    return row;
  });
}

function toCsv(rows) {
  if (!rows.length) return '';
  const header = Object.keys(rows[0]);
  const lines = [header.join(',')];
  rows.forEach((row) => {
    lines.push(header.map((key) => JSON.stringify(row[key] ?? '')).join(','));
  });
  return lines.join('\n');
}

function normalizeSortValue(value) {
  if (value === null || value === undefined) return '';
  const numeric = Number(value);
  if (!Number.isNaN(numeric) && value !== '') return numeric;
  return String(value).toLowerCase();
}

function renderSortIndicator(activeKey, direction, key) {
  if (activeKey !== key) return null;
  return direction === 'asc' ? '▲' : '▼';
}

export default App;
