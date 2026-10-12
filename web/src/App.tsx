import {memo, useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {Theme} from '@astryxdesign/core/theme';
import {neutralTheme} from '@astryxdesign/theme-neutral/built';
import {Button} from '@astryxdesign/core/Button';
import {Heading} from '@astryxdesign/core/Heading';
import {Kbd} from '@astryxdesign/core/Kbd';
import {Icon} from '@astryxdesign/core/Icon';
import {SegmentedControl, SegmentedControlItem} from '@astryxdesign/core/SegmentedControl';
import {Slider} from '@astryxdesign/core/Slider';
import {Step, Stepper} from '@astryxdesign/core/Stepper';
import {Tab, TabList} from '@astryxdesign/core/TabList';
import {Text} from '@astryxdesign/core/Text';
import {ToggleButton} from '@astryxdesign/core/ToggleButton';
import {InternationalizationProvider} from '@astryxdesign/core/i18n';
import koKR from '@astryxdesign/core/locales/ko-KR.generated.js';
import {LANGS, MESSAGES, detectLang, reasonText, saveLang, variantText, type Lang} from './i18n';
import './App.css';

type Kind = 'album' | 'artist' | 'track';
type Status = 'auto' | 'review' | 'substitute' | 'not_found' | 'exists';
type Decision = 'pending' | 'accept' | 'skip' | 'preserve';
type Level = 'ok' | 'warn' | 'bad';
type Why = [code: string, level: Level, param?: string | number];
type T = (typeof MESSAGES)[Lang];

// Shapes returned by /api/state (see store.records)
interface Src {
  id: string; kind: Kind; title: string; artists: string[]; album: string | null; year: number | null;
  duration_s: number | null; track_count: number | null; video_type: string | null; img: string | null; uri: string | null;
}
interface Cand {item: Src; score: number; why: Why[]}
interface Rec {
  key: string; kind: Kind; src: Src; status: Status; cands: Cand[]; variant: string | null; parsed_artist: string | null;
  decision: Decision; chosen: number; apply_status: 'none' | 'done' | 'failed'; apply_error: string | null;
}
interface State {
  records: Rec[]; library_uris: string[]; unavailable_tracks: number; cut: number; preserve_playlist: string | null;
  unmatched: Partial<Record<Kind, number>>; quota_reset_at: number | null;
}

const KINDS: Kind[] = ['album', 'artist', 'track'];
// Filters follow the user's decision, not the matcher's verdict: "to check" means "I haven't decided yet".
const FILTERS = ['todo', 'accept', 'preserve', 'skip', 'all'] as const;
type Filter = (typeof FILTERS)[number];
const LEAVE_MS = 280;  // a decided row fades out quickly so the user sees it went (650ms felt sluggish)

const matchesFilter = (d: Rec, f: Filter) =>
  f === 'all' || (f === 'todo' ? d.decision === 'pending' : d.decision === f);
const chosenOf = (d: Rec): Cand | undefined => d.cands[Math.min(d.chosen, d.cands.length - 1)];
const scoreOf = (d: Rec) => chosenOf(d)?.score ?? 0;
const mmss = (s: number | null) => (s ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : '');

async function api<R>(path: string, body?: unknown): Promise<R> {
  const r = await fetch(path, body === undefined ? {} : {
    method: 'POST', headers: {'content-type': 'application/json', 'x-ytm2spotify': '1'}, body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error((await r.json().catch(() => ({detail: r.statusText}))).detail ?? r.statusText);
  return r.json();
}

export default function App() {
  const q = new URLSearchParams(location.search);
  const [lang, setLang] = useState<Lang>(detectLang);
  const t = MESSAGES[lang];
  useEffect(() => { document.documentElement.lang = lang; saveLang(lang); }, [lang]);

  const [items, setItems] = useState<Rec[] | null>(null);
  const [meta, setMeta] = useState({unavailable: 0, playlist: null as string | null, unmatched: {} as Partial<Record<Kind, number>>, quotaResetAt: null as number | null});
  const [view, setView] = useState<'review' | 'done'>(q.get('view') === 'done' ? 'done' : 'review');
  const [libraryUris, setLibraryUris] = useState<Set<string>>(new Set());
  const [loadError, setLoadError] = useState<string | null>(null);
  const [kind, setKind] = useState<Kind>(() => KINDS.includes(q.get('tab') as Kind) ? (q.get('tab') as Kind) : 'album');
  const [filter, setFilter] = useState<Filter>(() => (FILTERS as readonly string[]).includes(q.get('filter') ?? '') ? (q.get('filter') as Filter) : 'todo');
  const [cut, setCut] = useState(0.9);
  const [previewing, setPreviewing] = useState(false);
  const [sel, setSel] = useState(0);
  const [open, setOpen] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState<'save' | 'preserve' | null>(null);
  const [leaving, setLeaving] = useState<Set<string>>(new Set());
  // Render the list in pages: hundreds of cards at once made switching views feel sluggish.
  const PAGE = 30;
  const [shown, setShown] = useState(PAGE);
  const sentinel = useRef<HTMLLIElement>(null);

  const load = useCallback(async () => {
    try {
      const s = await api<State>('/api/state');
      setItems(s.records);
      setCut(s.cut);
      setMeta({unavailable: s.unavailable_tracks, playlist: s.preserve_playlist, unmatched: s.unmatched, quotaResetAt: s.quota_reset_at});
      setLibraryUris(new Set(s.library_uris));
      setLoadError(null);
    } catch (e) { setLoadError(String((e as Error).message)); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const say = (msg: string) => { setToast(msg); window.setTimeout(() => setToast(null), 2600); };
  const fail = (e: unknown) => say(String((e as Error).message ?? e));

  // optimistic local update + persist
  const setDecision = (keys: string[], decision: Decision, chosen?: number) => {
    const ks = new Set(keys);
    // keep just-decided rows on screen for a moment, then let the filter drop them
    setLeaving(prev => new Set([...prev, ...keys]));
    window.setTimeout(() => setLeaving(prev => { const n = new Set(prev); keys.forEach(k => n.delete(k)); return n; }), LEAVE_MS);
    setItems(xs => xs && xs.map(d => (ks.has(d.key) ? {...d, decision, chosen: chosen ?? d.chosen} : d)));
    api('/api/decision', {keys, decision, chosen: chosen ?? null}).catch(e => { fail(e); load(); });
  };
  const toggle = (d: Rec, k: Decision) => {
    if (k === 'accept' && !d.cands.length) return;
    setDecision([d.key], d.decision === k ? 'pending' : k);
  };

  const all = items ?? [];
  const rows = useMemo(
    () => all.filter(d => d.kind === kind && (matchesFilter(d, filter) || leaving.has(d.key)))
      .sort((a, b) => scoreOf(b) - scoreOf(a)),
    [all, kind, filter, leaving],
  );
  const inKind = all.filter(d => d.kind === kind);
  const todo = inKind.filter(d => d.decision === 'pending');
  const bulk = todo.filter(d => d.cands.length && scoreOf(d) >= cut);
  const count = (k: Decision) => all.filter(d => d.decision === k).length;
  const toSave = all.filter(d => d.decision === 'accept' && d.apply_status !== 'done' && d.cands.length);
  const previewN = previewing ? bulk.length : 0;
  // Spotify URI → keys that will save it; used to flag duplicates (a remix and its original)
  const savers = new Map<string, string[]>();
  for (const d of all) {
    const u = d.decision === 'accept' ? chosenOf(d)?.item.uri : null;
    if (u) savers.set(u, [...(savers.get(u) ?? []), d.key]);
  }
  const dupOf = (d: Rec): 'library' | 'other' | null => {
    const u = chosenOf(d)?.item.uri;
    if (!u || d.status === 'exists') return null;
    if (libraryUris.has(u)) return 'library';
    return (savers.get(u) ?? []).some(k => k !== d.key) ? 'other' : null;
  };
  const totals = Object.fromEntries(KINDS.map(k => [k, all.filter(d => d.kind === k).length])) as Record<Kind, number>;
  // similar pending variants (e.g. 12 remixes) can be handled together
  const groups = Object.entries(
    inKind.filter(d => d.status === 'substitute' && d.decision === 'pending' && d.variant)
      .reduce<Record<string, Rec[]>>((acc, d) => ((acc[d.variant!] ??= []).push(d), acc), {}),
  ).filter(([, v]) => v.length >= 2).sort((a, b) => b[1].length - a[1].length);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, textarea')) return;
      const d = rows[sel];
      // in "to check" the decided row leaves, so the next one slides into the same index
      const next = () => { if (filter !== 'todo') setSel(s => Math.min(rows.length - 1, s + 1)); };
      if (e.key === 'ArrowDown' || e.key === 'j') setSel(s => Math.min(rows.length - 1, s + 1));
      else if (e.key === 'ArrowUp' || e.key === 'k') setSel(s => Math.max(0, s - 1));
      else if (!d) return;
      else if (e.key === 'y') { toggle(d, 'accept'); next(); }
      else if (e.key === 'n') { toggle(d, 'skip'); next(); }
      else if (e.key === 'p') { toggle(d, 'preserve'); next(); }
      else if (e.key === 'Enter') setOpen(o => (o === d.key ? null : d.key));
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  useEffect(() => { setShown(PAGE); }, [kind, filter, view]);
  useEffect(() => { if (sel >= shown - 5) setShown(n => n + PAGE); }, [sel, shown]);
  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver(es => { if (es[0].isIntersecting) setShown(n => n + PAGE); }, {rootMargin: '600px'});
    io.observe(el);
    return () => io.disconnect();
  });
  useEffect(() => { document.querySelector('.pair.is-selected')?.scrollIntoView({block: 'nearest'}); }, [sel]);
  useEffect(() => {
    const u = new URL(location.href);
    u.searchParams.set('tab', kind);
    u.searchParams.set('filter', filter);
    if (view === 'done') u.searchParams.set('view', 'done'); else u.searchParams.delete('view');
    history.replaceState(null, '', u);
  }, [kind, filter, view]);
  const panelRef = useFloatyPanel();

  const save = async (trial: boolean) => {
    setBusy('save');
    try {
      const r = await api<{saved: number; failed: number; already: number}>('/api/apply', trial ? {kinds: ['album'], limit: 5} : {});
      say(r.saved + r.failed + r.already ? t.savedResult(r.saved, r.failed) + (r.already ? ` · ${t.alreadyCount(r.already)}` : '') : t.nothingToSave);
      setConfirming(false);
      await load();
      if (!trial) { setView('done'); window.scrollTo({top: 0}); }
    } catch (e) { fail(e); } finally { setBusy(null); }
  };
  const preserve = async () => {
    setBusy('preserve');
    try {
      const r = await api<{playlist: string | null; tracks: number}>('/api/preserve', {});
      say(t.preserveDone(r.tracks));
      await load();
    } catch (e) { fail(e); } finally { setBusy(null); }
  };
  const preservedTracks = all.filter(d => d.decision === 'preserve' && d.kind === 'track').length;

  return (
    <InternationalizationProvider locale={lang === 'ko' ? 'ko-KR' : 'en'} messages={{'ko-KR': koKR}}>
    <Theme theme={neutralTheme} mode="light">
      <div className="page">
        <header className="top">
          <div className="top-in">
            <div className="stepper">
              <Stepper activeStep={view === 'done' ? 5 : 3} density="compact" horizontalOptions={{minimumStepWidth: 84, collapsedVariant: 'withLabel'}}
                onStepClick={i => { if (i === 3) setView('review'); if (i === 5 && all.some(d => d.apply_status === 'done')) setView('done'); }}>
                {t.steps.map((l, i) => <Step key={i} step={i} label={l} />)}
              </Stepper>
            </div>
            <div className="top-end">
              <SegmentedControl label="Language" size="sm" value={lang} onChange={v => setLang(v as Lang)}>
                {LANGS.map(l => <SegmentedControlItem key={l} value={l} label={l === 'ko' ? '한국어' : 'EN'} />)}
              </SegmentedControl>
              <div className="brand"><span className="mark" aria-hidden />ytm2spotify</div>
            </div>
          </div>
        </header>

        {!items ? (
          <div className="shell"><div className="lead"><Text color="secondary">{loadError ? t.loadError(loadError) : t.loading}</Text></div></div>
        ) : view === 'done' ? (
          <Results t={t} lang={lang} all={all} meta={meta} busy={busy} preservedTracks={preservedTracks}
            onBack={() => setView('review')} onPreserve={preserve} />
        ) : items.length === 0 ? (
          <div className="shell"><div className="lead"><Text>{t.emptyLibrary}</Text></div></div>
        ) : (
        <div className="shell">
          <div className="lead">
            <section className="intro">
              <Heading level={1}>{t.headline(t.kind[kind], todo.length)}</Heading>
              <Text type="large" color="secondary" as="p">{t.lede(t.kind[kind], totals[kind])}</Text>
              {kind === 'track' && meta.unavailable > 0 && <Text type="supporting" as="p">{t.unavailable(meta.unavailable)}</Text>}
            </section>

            <TabList value={kind} onChange={v => { setKind(v as Kind); setSel(0); setOpen(null); setPreviewing(false); }} hasDivider size="lg">
              {KINDS.map(k => (
                <Tab key={k} value={k} label={t.kind[k]} endContent={<span className="tab-count">{totals[k].toLocaleString(lang)}</span>} />
              ))}
            </TabList>

            <div className="toolbar">
              <SegmentedControl label={t.filterLabel} value={filter} onChange={v => { setFilter(v as Filter); setSel(0); }}>
                {FILTERS.map(f => (
                  <SegmentedControlItem key={f} value={f} label={`${t.filter[f]} ${inKind.filter(d => matchesFilter(d, f)).length}`} />
                ))}
              </SegmentedControl>
            </div>
          </div>

          <main className="main">
            {groups.slice(0, 2).map(([v, list]) => (
              <div className="group-hint" key={v}>
                <div>
                  <Text weight="semibold" as="p" display="block">{t.groupTitleOf(t.variant[v] ?? v, list.length)}</Text>
                  <Text type="supporting" as="p" display="block">{t.groupBody}</Text>
                </div>
                <div className="banner-actions">
                  <Button size="sm" label={t.groupKeepAll} onClick={() => { setDecision(list.map(d => d.key), 'preserve'); say(t.toastGroupKept); }} />
                  <Button size="sm" label={t.groupReplace} onClick={() => {
                    const withOrig = list.filter(d => d.cands.length).map(d => d.key);
                    setDecision(withOrig, 'accept');
                    setDecision(list.filter(d => !d.cands.length).map(d => d.key), 'preserve');
                    say(t.toastGroupReplaced);
                  }} />
                </div>
              </div>
            ))}

            <ol className="pairs">
              {rows.length === 0 && <li className="empty"><Text color="secondary">{t.empty}</Text></li>}
              {rows.slice(0, shown).map((d, i) => (
                <PairRow key={d.key} index={i} d={d} t={t} dup={dupOf(d)} selected={i === sel} isLeaving={leaving.has(d.key) && !matchesFilter(d, filter)} willAccept={previewing && bulk.includes(d)} cut={Math.round(cut * 100)}
                  isOpen={open === d.key}
                  onSelect={() => setSel(i)} onToggle={() => setOpen(o => (o === d.key ? null : d.key))}
                  onDecide={k => toggle(d, k)}
                  onPick={j => { setDecision([d.key], 'accept', j); say(t.toastPicked); }}
                  onSearch={async query => {
                    const r = await api<{cands: Cand[]}>('/api/search', {key: d.key, q: query});
                    setItems(xs => xs && xs.map(x => (x.key === d.key ? {...x, cands: r.cands} : x)));
                    return r.cands.length;
                  }} />
              ))}
              {rows.length > shown && <li ref={sentinel} className="more" aria-hidden />}
            </ol>
          </main>

          <aside ref={panelRef} className="side-panel" aria-label={t.panelLabel}>
            <section className="panel-block progress" aria-live="polite">
              <Text type="supporting" display="block">{t.progress}</Text>
              <p className="progress-headline">
                {(([a, b, c]) => <>{a}<b>{b}</b>{c}</>)(t.remaining(count('pending') - previewN))}
              </p>
              <div className="meter" aria-hidden>
                {(['accept', 'preview', 'preserve', 'skip', 'pending'] as const).map(k => {
                  const n = k === 'preview' ? previewN : k === 'pending' ? count('pending') - previewN : count(k);
                  return n > 0 ? <span key={k} className={`m-${k}`} style={{flexGrow: n}} /> : null;
                })}
              </div>
              <dl className="tally">
                <div className="t-accept"><dt><i className="m-accept" />{t.tally.accept}</dt><dd>{count('accept')}{previewN > 0 && <em>+{previewN}</em>}</dd></div>
                <div><dt><i className="m-preserve" />{t.tally.preserve}</dt><dd>{count('preserve')}</dd></div>
                <div><dt><i className="m-skip" />{t.tally.skip}</dt><dd>{count('skip')}</dd></div>
                <div className="t-todo"><dt><i className="m-pending" />{t.tally.pending}</dt><dd>{count('pending') - previewN}</dd></div>
              </dl>
              {!confirming ? (
                <span className="save-btn">
                  <Button variant="primary" size="lg" width="100%" label={t.save(toSave.length)} isDisabled={!toSave.length}
                    onClick={() => setConfirming(true)} />
                </span>
              ) : (
                <div className="confirm">
                  <Text weight="semibold" display="block">{t.confirmTitle(toSave.length)}</Text>
                  <Text type="supporting" display="block">{t.confirmBody}</Text>
                  <span className="save-btn">
                    <Button variant="primary" width="100%" label={busy === 'save' ? t.saving : t.confirmAll} isLoading={busy === 'save'} onClick={() => save(false)} />
                  </span>
                  <Button width="100%" label={t.confirmTrial} isDisabled={busy !== null || !toSave.some(d => d.kind === 'album')} onClick={() => save(true)} />
                  <Button width="100%" variant="ghost" label={t.cancel} isDisabled={busy !== null} onClick={() => setConfirming(false)} />
                </div>
              )}
              {count('pending') > 0 && !confirming && <Text type="supporting" display="block">{t.saveNote}</Text>}
              {!confirming && all.some(d => d.apply_status === 'done') && (
                <Button variant="ghost" width="100%" label={t.seeResults} onClick={() => { setView('done'); window.scrollTo({top: 0}); }} />
              )}
            </section>

            <section className="panel-block">
              <Text weight="semibold" display="block">{t.bulkTitle}</Text>
              <Text type="supporting" display="block">{t.bulkBody}</Text>
              <Slider label={t.bulkSlider} isLabelHidden value={cut} min={0.6} max={1} step={0.01}
                onChange={(v: number) => { setCut(v); setPreviewing(true); }}
                onChangeEnd={(v: number) => { api('/api/cut', {cut: v}).catch(() => {}); }}
                formatValue={(v: number) => t.points(Math.round(v * 100))} valueDisplay="text" width="100%" />
              <Button width="100%" label={t.bulkButton(Math.round(cut * 100), bulk.length)} isDisabled={!bulk.length}
                onClick={() => { setDecision(bulk.map(d => d.key), 'accept'); setPreviewing(false); say(t.toastBulk(bulk.length)); }} />
            </section>

            <section className="panel-block">
              <Text weight="semibold" display="block">{t.preserveTitle}</Text>
              <Text type="supporting" display="block">{t.preserveBody(preservedTracks)}</Text>
              <Button width="100%" label={busy === 'preserve' ? t.saving : t.preserveButton} isLoading={busy === 'preserve'}
                isDisabled={!preservedTracks || busy !== null} onClick={preserve} />
              <div className="panel-links">
                {meta.playlist && <a href={`https://music.youtube.com/playlist?list=${meta.playlist}`} target="_blank" rel="noreferrer">{t.preserveOpen}</a>}
                <a href="/api/preserved.csv">{t.csv}</a>
              </div>
            </section>

            <details className="panel-keys">
              <summary>{t.shortcuts}</summary>
              <ul>
                <li><span><Kbd keys="up" /><Kbd keys="down" /></span>{t.keys.move}</li>
                <li><Kbd keys="Y" />{t.keys.accept}</li>
                <li><Kbd keys="N" />{t.keys.skip}</li>
                <li><Kbd keys="P" />{t.keys.keep}</li>
                <li><Kbd keys="enter" />{t.keys.alts}</li>
              </ul>
            </details>
          </aside>
        </div>
        )}
        {toast && <div className="toast" role="status">{toast}</div>}
      </div>
    </Theme>
    </InternationalizationProvider>
  );
}

function Results({t, lang, all, meta, busy, preservedTracks, onBack, onPreserve}: {
  t: T; lang: Lang; all: Rec[]; busy: string | null; preservedTracks: number;
  meta: {playlist: string | null; unavailable: number; unmatched: Partial<Record<Kind, number>>; quotaResetAt: number | null};
  onBack: () => void; onPreserve: () => void;
}) {
  const by = (k: Kind, f: (d: Rec) => boolean) => all.filter(d => d.kind === k && f(d)).length;
  const rows: {k: Kind; saved: number; already: number; kept: number; skipped: number; failed: number; todo: number}[] = KINDS.map(k => ({
    k,
    saved: by(k, d => d.apply_status === 'done' && d.status !== 'exists'),
    already: by(k, d => d.status === 'exists'),
    kept: by(k, d => d.decision === 'preserve'),
    skipped: by(k, d => d.decision === 'skip' && d.status !== 'exists'),
    failed: by(k, d => d.apply_status === 'failed'),
    todo: by(k, d => d.decision === 'pending') + (meta.unmatched[k] ?? 0),
  }));
  const savedTotal = rows.reduce((n, r) => n + r.saved, 0);
  const unmatchedTotal = Object.values(meta.unmatched).reduce((n, x) => n + (x ?? 0), 0);
  const resetAt = meta.quotaResetAt && meta.quotaResetAt * 1000 > Date.now()
    ? new Date(meta.quotaResetAt * 1000).toLocaleString(lang === 'ko' ? 'ko-KR' : 'en', {month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'})
    : null;
  return (
    <div className="shell results">
      <div className="lead">
        <section className="intro">
          <Heading level={1}>{t.doneHeadline(savedTotal)}</Heading>
          <Text type="large" color="secondary" as="p">{t.doneLede}</Text>
        </section>
      </div>
      <main className="main">
        <table className="result-table">
          <thead><tr><th />{(['saved', 'already', 'kept', 'skipped', 'failed', 'todo'] as const).map(c => <th key={c}>{t.resultCol[c]}</th>)}</tr></thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.k}>
                <th scope="row">{t.kind[r.k]}</th>
                <td className="c-saved">{r.saved}</td><td>{r.already}</td><td>{r.kept}</td><td>{r.skipped}</td>
                <td className={r.failed ? 'c-failed' : ''}>{r.failed}</td><td className={r.todo ? 'c-todo' : ''}>{r.todo}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {meta.unavailable > 0 && <Text type="supporting" as="p">{t.unavailable(meta.unavailable)}</Text>}

        {unmatchedTotal > 0 && (
          <div className="next-card">
            <Text weight="semibold" display="block">{t.unmatchedTitle(unmatchedTotal)}</Text>
            <Text type="supporting" display="block">{resetAt ? t.quotaUntil(resetAt) : t.unmatchedBody}</Text>
            <code className="cmd">./y2s match</code>
          </div>
        )}
      </main>
      <aside className="side-panel">
        <section className="panel-block">
          <Text weight="semibold" display="block">{t.preserveTitle}</Text>
          <Text type="supporting" display="block">{t.preserveBody(preservedTracks)}</Text>
          <Button width="100%" label={busy === 'preserve' ? t.saving : t.preserveButton} isLoading={busy === 'preserve'}
            isDisabled={!preservedTracks || busy !== null} onClick={onPreserve} />
          <div className="panel-links">
            {meta.playlist && <a href={`https://music.youtube.com/playlist?list=${meta.playlist}`} target="_blank" rel="noreferrer">{t.preserveOpen}</a>}
            <a href="/api/preserved.csv">{t.csv}</a>
          </div>
        </section>
        <section className="panel-block">
          <Button width="100%" label={t.backToReview} onClick={onBack} />
          <a className="panel-link-strong" href="https://open.spotify.com/collection/albums" target="_blank" rel="noreferrer">{t.openSpotify}</a>
        </section>
      </aside>
    </div>
  );
}

function Cover({src, round, variant}: {src: string | null; round?: boolean; variant: 'ytm' | 'sp' | 'empty'}) {
  return (
    <span className={`cover cover-${variant} ${round ? 'is-round' : ''}`}>
      {src ? <img src={src} alt="" loading="lazy" referrerPolicy="no-referrer" /> : null}
      <span className="source-dot" aria-hidden />
    </span>
  );
}

function Meta({parts}: {parts: (string | number | null | undefined)[]}) {
  const xs = parts.filter(p => p !== null && p !== undefined && p !== '').map(String);
  return <span className="meta">{xs.length ? xs.map((p, i) => <span key={i}>{p}</span>) : <span>&nbsp;</span>}</span>;
}

function metaOf(t: T, s: Src, side: 'from' | 'to') {
  if (s.kind === 'album') return [s.year, s.track_count ? t.trackCount(s.track_count) : null];
  if (s.kind === 'track') return [s.album ?? (side === 'from' ? t.noAlbum : null), mmss(s.duration_s)];
  return [];
}

const PairRow = memo(PairRowImpl, (a, b) =>
  a.d === b.d && a.t === b.t && a.dup === b.dup && a.selected === b.selected && a.isLeaving === b.isLeaving &&
  a.willAccept === b.willAccept && a.cut === b.cut && a.isOpen === b.isOpen && a.index === b.index);

function PairRowImpl({d, t, dup, selected, isLeaving, willAccept, cut, isOpen, onSelect, onToggle, onDecide, onPick, onSearch}: {
  index: number; d: Rec; t: T; dup: 'library' | 'other' | null; selected: boolean; isLeaving: boolean; willAccept: boolean; cut: number; isOpen: boolean;
  onSelect: () => void; onToggle: () => void; onDecide: (k: Decision) => void; onPick: (j: number) => void;
  onSearch: (q: string) => Promise<number>;
}) {
  const c = chosenOf(d);
  const round = d.kind === 'artist';
  const score = c ? Math.round(c.score * 100) : null;
  const rank: Record<Level, number> = {bad: 0, warn: 1, ok: 2};
  const reasons: [string, Level][] = [
    ...(d.src.video_type === 'MUSIC_VIDEO_TYPE_UGC' ? [[t.ugc, 'warn'] as [string, Level]] : []),
    ...(c?.why.filter(([code]) => !code.startsWith('variant:')).map(([code, level, param]) => [reasonText(t, code, param), level] as [string, Level]) ?? []),
  ].sort((x, y) => rank[x[1]] - rank[y[1]]);
  const [query, setQuery] = useState('');
  const [searchState, setSearchState] = useState<'idle' | 'busy' | 'empty'>('idle');
  const note = d.apply_status === 'done' ? t.applied : d.apply_status === 'failed' ? `${t.applyFailed}: ${d.apply_error ?? ''}` : t.decisionNote[d.decision];

  return (
    <li className={`pair status-${d.status} decision-${d.decision} ${selected ? 'is-selected' : ''} ${willAccept ? 'is-preview' : ''} ${d.apply_status === 'done' ? 'is-applied' : ''} ${isLeaving ? 'is-leaving' : ''}`} onClick={onSelect}>
      <div className="head">
        <span className="verdict">{t.status[d.status]}</span>
        {score !== null && <span className="match">{t.match(score)}</span>}
        {dup && <span className="dup-note">{dup === 'library' ? t.dupLibrary : t.dupOther}</span>}
        {d.status === 'substitute' && d.variant && <span className="variant-note">{t.variantNote(variantText(t, `variant:${d.variant}`))}</span>}
        {willAccept && <span className="will-accept">{t.willAccept(cut)}</span>}
        {note && <span className={`chosen-note ${d.apply_status === 'failed' ? 'is-error' : ''}`}>{note}</span>}
      </div>
      <div className="compare">
        <Cover src={d.src.img} round={round} variant="ytm" />
        <div className="names from">
          <Text weight="semibold" maxLines={2}>{d.src.title}</Text>
          <Text type="supporting" maxLines={1}>{d.src.artists.join(', ') || t.ytmSubscribed}</Text>
          <Meta parts={metaOf(t, d.src, 'from')} />
        </div>
        <div className="link" aria-hidden><span className="arrow" /></div>
        <Cover src={c?.item.img ?? null} round={round} variant={c ? 'sp' : 'empty'} />
        <div className="names to">
          {c ? (
            <>
              <Text weight="semibold" maxLines={2}>{c.item.title}</Text>
              <Text type="supporting" maxLines={1}>{c.item.artists.join(', ') || t.spotifyArtist}</Text>
              <Meta parts={metaOf(t, c.item, 'to')} />
            </>
          ) : (
            <>
              <Text weight="semibold" color="secondary">{t.notFoundTitle}</Text>
              <Text type="supporting">{t.notFoundBody}</Text>
              <span />
            </>
          )}
        </div>
      </div>

      <div className="decide" onClick={e => e.stopPropagation()}>
        <div className="choices">
          {c && <span className="d d-accept"><ToggleButton size="sm" label={t.accept} isPressed={d.decision === 'accept'} onPressedChange={() => onDecide('accept')} /></span>}
          <span className="d d-skip"><ToggleButton size="sm" label={t.skip} isPressed={d.decision === 'skip'} onPressedChange={() => onDecide('skip')} /></span>
          <span className="d d-preserve"><ToggleButton size="sm" label={t.keep} isPressed={d.decision === 'preserve'} onPressedChange={() => onDecide('preserve')} /></span>
          <span className="sep" aria-hidden />
          <span className="d d-find"><Button size="sm" variant="ghost" icon={<Icon icon="search" />} label={d.cands.length > 1 ? t.otherCands(d.cands.length - 1) : t.findOther} onClick={onToggle} /></span>
        </div>
        {reasons.length > 0 && (
          <ul className="reasons" aria-label={t.reasonsLabel}>
            {reasons.map(([text, level]) => (
              <li key={text} className={`reason r-${level}`}><span className="r-icon" aria-hidden>{level === 'ok' ? '✓' : '!'}</span>{text}</li>
            ))}
          </ul>
        )}
      </div>

      {isOpen && (
        <div className="alts" onClick={e => e.stopPropagation()}>
          {d.cands.map((x, j) => (
            <button key={x.item.id} className={`alt ${j === d.chosen ? 'is-chosen' : ''}`} onClick={() => onPick(j)}>
              <Cover src={x.item.img} round={round} variant="sp" />
              <span className="names">
                <Text weight="semibold" maxLines={1}>{x.item.title}</Text>
                <Text type="supporting" maxLines={1}>{[x.item.artists.join(', '), ...metaOf(t, x.item, 'to')].filter(Boolean).join(' · ')}</Text>
              </span>
              <span className="alt-score">{Math.round(x.score * 100)}</span>
            </button>
          ))}
          <form className="search" onSubmit={async e => {
            e.preventDefault();
            if (!query.trim()) return;
            setSearchState('busy');
            try { setSearchState((await onSearch(query.trim())) ? 'idle' : 'empty'); } catch { setSearchState('empty'); }
          }}>
            <label className="visually-hidden" htmlFor={`q-${d.key}`}>{t.searchLabel}</label>
            <input id={`q-${d.key}`} value={query} onChange={e => setQuery(e.target.value)}
              placeholder={t.searchPlaceholder(d.parsed_artist ? `${d.parsed_artist} …` : d.src.title.slice(0, 16))} />
            {searchState !== 'idle' && <Text type="supporting">{searchState === 'busy' ? t.searching : t.noResults}</Text>}
          </form>
        </div>
      )}
    </li>
  );
}

// The side panel stays sticky but trails the scroll a little and settles back with a soft spring,
// so it feels attached to the page rather than bolted to the screen. Off for reduced motion.
function useFloatyPanel() {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let lastY = window.scrollY, pos = 0, vel = 0, frame = 0;
    const MAX = 12;          // px the panel may trail behind
    const STIFFNESS = 0.06;  // lower = slower return
    const DAMPING = 0.8;     // velocity kept per frame; lower = less bounce
    const tick = () => {
      vel = (vel - pos * STIFFNESS) * DAMPING;
      pos = Math.max(-MAX, Math.min(MAX, pos + vel));
      el.style.transform = `translate3d(0, ${pos.toFixed(2)}px, 0)`;
      if (Math.abs(pos) > 0.05 || Math.abs(vel) > 0.05) frame = requestAnimationFrame(tick);
      else { el.style.transform = ''; frame = 0; }
    };
    const onScroll = () => {
      if (window.innerWidth <= 1080) return;
      const y = window.scrollY;
      vel += Math.max(-4, Math.min(4, -(y - lastY) * 0.08));
      lastY = y;
      el.classList.toggle('is-scrolled', y > 40);
      if (!frame) frame = requestAnimationFrame(tick);
    };
    window.addEventListener('scroll', onScroll, {passive: true});
    return () => { window.removeEventListener('scroll', onScroll); cancelAnimationFrame(frame); };
  });
  return ref;
}
