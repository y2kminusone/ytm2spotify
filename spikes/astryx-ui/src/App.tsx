import {useEffect, useMemo, useRef, useState} from 'react';
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
import sample from './sample.json';
import {LANGS, MESSAGES, detectLang, reasonText, saveLang, variantText, type Lang} from './i18n';
import './App.css';

type Kind = 'album' | 'artist' | 'track';
type Status = 'auto' | 'review' | 'substitute' | 'not_found' | 'exists';
type Decision = 'pending' | 'accept' | 'skip' | 'preserve';
type Level = 'ok' | 'warn' | 'bad';
type Why = [code: string, level: Level, param?: string | number];
interface Cand {title: string; artists: string; img: string | null; meta: string; tracks?: number | null; score: number; why: Why[]}
interface Item {
  id: number; kind: Kind; status: Status; chosen: number; decision: Decision;
  src: {title: string; artists: string; meta: string; img: string | null; vt?: string; group?: string | null};
  cands: Cand[];
}

const INITIAL: Record<Status, Decision> = {auto: 'accept', exists: 'skip', not_found: 'preserve', review: 'pending', substitute: 'pending'};
const KINDS: Kind[] = ['album', 'artist', 'track'];
const FILTERS = ['todo', 'auto', 'not_found', 'exists', 'all'] as const;
type Filter = (typeof FILTERS)[number];

const initialItems = (): Item[] =>
  (sample.items as unknown as Omit<Item, 'id' | 'chosen' | 'decision'>[]).map((d, id) => ({
    ...d, id, chosen: 0,
    decision: d.status === 'auto' && d.src.vt === 'UGC' ? 'pending' : INITIAL[d.status as Status],
  }));

const matchesFilter = (d: Item, f: Filter) =>
  f === 'all' || (f === 'todo' ? d.status === 'review' || d.status === 'substitute' : d.status === f);
const scoreOf = (d: Item) => d.cands[d.chosen]?.score ?? 0;

export default function App() {
  const q = new URLSearchParams(location.search);  // prototype: ?look=butter&tab=track&filter=all
  const [lang, setLang] = useState<Lang>(detectLang);
  const t = MESSAGES[lang];
  useEffect(() => { document.documentElement.lang = lang; saveLang(lang); }, [lang]);
  const [items, setItems] = useState(initialItems);
  const [kind, setKind] = useState<Kind>(() => KINDS.includes(q.get('tab') as Kind) ? (q.get('tab') as Kind) : 'track');
  const [filter, setFilter] = useState<Filter>(() => (FILTERS as readonly string[]).includes(q.get('filter') ?? '') ? (q.get('filter') as Filter) : 'todo');
  const [cut, setCut] = useState(Number(q.get('cut')) || 0.9);
  const [previewing, setPreviewing] = useState(q.has('cut'));
  const [sel, setSel] = useState(0);
  const [open, setOpen] = useState<number | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const rows = useMemo(
    () => items.filter(d => d.kind === kind && matchesFilter(d, filter)).sort((a, b) => scoreOf(b) - scoreOf(a)),
    [items, kind, filter],
  );
  const inKind = items.filter(d => d.kind === kind);
  const todo = inKind.filter(d => d.decision === 'pending');
  const bulk = todo.filter(d => d.cands.length && scoreOf(d) >= cut);
  const count = (k: Decision) => items.filter(d => d.decision === k).length;
  const previewN = previewing ? bulk.length : 0;
  const group = kind === 'track' ? inKind.filter(d => d.src.group && d.decision !== 'preserve') : [];

  const say = (t: string) => { setToast(t); window.setTimeout(() => setToast(null), 1600); };
  const decide = (id: number, k: Decision) =>
    setItems(xs => xs.map(d => (d.id === id && (k !== 'accept' || d.cands.length) ? {...d, decision: d.decision === k ? 'pending' : k} : d)));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, textarea')) return;
      const d = rows[sel];
      const next = () => setSel(s => Math.min(rows.length - 1, s + 1));
      if (e.key === 'ArrowDown' || e.key === 'j') setSel(s => Math.min(rows.length - 1, s + 1));
      else if (e.key === 'ArrowUp' || e.key === 'k') setSel(s => Math.max(0, s - 1));
      else if (!d) return;
      else if (e.key === 'y') { decide(d.id, 'accept'); next(); }
      else if (e.key === 'n') { decide(d.id, 'skip'); next(); }
      else if (e.key === 'p') { decide(d.id, 'preserve'); next(); }
      else if (e.key === 'Enter') setOpen(o => (o === d.id ? null : d.id));
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [rows, sel]);

  useEffect(() => { document.querySelector('.pair.is-selected')?.scrollIntoView({block: 'nearest'}); }, [sel]);

  const total = (sample.totals as Record<Kind, number>)[kind];
  const panelRef = useFloatyPanel();

  // Keep the view (tab + filter) in the URL so a refresh, back button or shared link lands on the same view.
  useEffect(() => {
    const u = new URL(location.href);
    u.searchParams.set('tab', kind);
    u.searchParams.set('filter', filter);
    history.replaceState(null, '', u);
  }, [kind, filter]);

  return (
    <InternationalizationProvider locale={lang === 'ko' ? 'ko-KR' : 'en'} messages={{'ko-KR': koKR}}>
    <Theme theme={neutralTheme} mode="light">
      <div className="page">
        <header className="top">
          <div className="top-in">
          <div className="stepper">
            <Stepper activeStep={3} density="compact" horizontalOptions={{minimumStepWidth: 84, collapsedVariant: 'withLabel'}}>
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

        <div className="shell">
        <div className="lead">
          <section className="intro">
            <Heading level={1}>
              {t.headline(t.kind[kind], todo.length)}
            </Heading>
            <Text type="large" color="secondary" as="p">
              {t.lede(t.kind[kind], total)}
            </Text>
            <Text type="supporting" as="p">{t.prototypeNote}</Text>
          </section>

          <TabList value={kind} onChange={v => { setKind(v as Kind); setSel(0); setOpen(null); setPreviewing(false); }} hasDivider size="lg">
            {KINDS.map(k => (
              <Tab key={k} value={k} label={t.kind[k]}
                endContent={<span className="tab-count">{(sample.totals as Record<Kind, number>)[k].toLocaleString(lang)}</span>} />
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
          {group.length >= 2 && (
            <div className="group-hint">
              <div>
                <Text weight="semibold" as="p" display="block">{t.groupTitle(group.length)}</Text>
                <Text type="supporting" as="p" display="block">{t.groupBody}</Text>
              </div>
              <div className="banner-actions">
                <Button size="sm" label={t.groupKeepAll} onClick={() => { setItems(xs => xs.map(d => (d.src.group ? {...d, decision: 'preserve'} : d))); say(t.toastGroupKept); }} />
                <Button size="sm" label={t.groupReplace} onClick={() => { setItems(xs => xs.map(d => (d.src.group ? {...d, decision: d.cands.length ? 'accept' : 'preserve'} : d))); say(t.toastGroupReplaced); }} />
              </div>
            </div>
          )}

          <ol className="pairs">
            {rows.length === 0 && <li className="empty"><Text color="secondary">{t.empty}</Text></li>}
            {rows.map((d, i) => (
              <PairRow key={d.id} d={d} selected={i === sel} willAccept={previewing && bulk.includes(d)} cut={Math.round(cut * 100)} t={t} isOpen={open === d.id}
                onSelect={() => setSel(i)} onToggle={() => setOpen(o => (o === d.id ? null : d.id))}
                onDecide={k => decide(d.id, k)}
                onPick={j => { setItems(xs => xs.map(x => (x.id === d.id ? {...x, chosen: j, decision: 'accept'} : x))); say(t.toastPicked); }} />
            ))}
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
            <span className="save-btn"><Button variant="primary" size="lg" width="100%" label={t.save(count('accept'))} onClick={() => say(t.toastSave)} /></span>
            {count('pending') > 0 && <Text type="supporting" display="block">{t.saveNote}</Text>}
          </section>

          <section className="panel-block">
            <Text weight="semibold" display="block">{t.bulkTitle}</Text>
            <Text type="supporting" display="block">{t.bulkBody}</Text>
            <Slider label={t.bulkSlider} isLabelHidden value={cut} min={0.7} max={1} step={0.01}
              onChange={(v: number) => { setCut(v); setPreviewing(true); }} formatValue={(v: number) => t.points(Math.round(v * 100))} valueDisplay="text" width="100%" />
            <Button width="100%" label={t.bulkButton(Math.round(cut * 100), bulk.length)}
              isDisabled={!bulk.length}
              onClick={() => { setItems(xs => xs.map(d => (bulk.includes(d) ? {...d, decision: 'accept'} : d))); setPreviewing(false); say(t.toastBulk(bulk.length)); }} />
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
        {toast && <div className="toast" role="status">{toast}</div>}
      </div>
    </Theme>
    </InternationalizationProvider>
  );
}

function Cover({src, alt, round, variant}: {src: string | null; alt: string; round?: boolean; variant: 'ytm' | 'sp' | 'empty'}) {
  return (
    <span className={`cover cover-${variant} ${round ? 'is-round' : ''}`}>
      {src ? <img src={src} alt={alt} loading="lazy" referrerPolicy="no-referrer" /> : null}
      <span className="source-dot" aria-hidden />
    </span>
  );
}

function Meta({text}: {text: string}) {
  const parts = text.split(' · ').filter(Boolean);
  return <span className="meta">{parts.map(p => <span key={p}>{p}</span>)}</span>;
}

function PairRow({d, t, selected, willAccept, cut, isOpen, onSelect, onToggle, onDecide, onPick}: {
  d: Item; t: (typeof MESSAGES)[Lang]; selected: boolean; willAccept: boolean; cut: number; isOpen: boolean;
  onSelect: () => void; onToggle: () => void; onDecide: (k: Decision) => void; onPick: (j: number) => void;
}) {
  const c = d.cands[d.chosen];
  const round = d.kind === 'artist';
  const score = c ? Math.round(c.score * 100) : null;
  // problems first, then what matched; the upload marker lives here too so both sides stay symmetric
  const rank: Record<Level, number> = {bad: 0, warn: 1, ok: 2};
  const variantWhy = c?.why.find(([code]) => code.startsWith('variant:'));
  const reasons: [string, Level][] = [
    ...(d.src.vt === 'UGC' ? [[t.ugc, 'warn'] as [string, Level]] : []),
    ...(c?.why.filter(([code]) => !code.startsWith('variant:')).map(([code, level, param]) => [reasonText(t, code, param), level] as [string, Level]) ?? []),
  ].sort((x, y) => rank[x[1]] - rank[y[1]]);
  const meta = (m: string, tracks?: number | null) => [m, tracks ? t.trackCount(tracks) : ''].filter(Boolean).join(' · ');
  const srcMeta = d.kind === 'track' && d.src.meta && !d.src.meta.includes(' · ') ? `${t.noAlbum} · ${d.src.meta}` : d.src.meta;
  return (
    <li className={`pair status-${d.status} decision-${d.decision} ${selected ? 'is-selected' : ''} ${willAccept ? 'is-preview' : ''}`} onClick={onSelect}>
      <div className="head">
        <span className="verdict">{t.status[d.status]}</span>
        {score !== null && <span className="match">{t.match(score)}</span>}
        {d.status === 'substitute' && variantWhy && <span className="variant-note">{t.variantNote(variantText(t, variantWhy[0], variantWhy[2]))}</span>}
        {willAccept && <span className="will-accept">{t.willAccept(cut)}</span>}
        {d.decision !== 'pending' && <span className="chosen-note">{t.decisionNote[d.decision]}</span>}
      </div>
      <div className="compare">
        <Cover src={d.src.img} alt="" round={round} variant="ytm" />
        <div className="names from">
          <Text weight="semibold" maxLines={2}>{d.src.title}</Text>
          <Text type="supporting" maxLines={1}>{d.src.artists || t.ytmSubscribed}</Text>
          <Meta text={srcMeta || ' '} />
        </div>
        <div className="link" aria-hidden><span className="arrow" /></div>
        <Cover src={c?.img ?? null} alt="" round={round} variant={c ? 'sp' : 'empty'} />
        <div className="names to">
          {c ? (
            <>
              <Text weight="semibold" maxLines={2}>{c.title}</Text>
              <Text type="supporting" maxLines={1}>{c.artists || t.spotifyArtist}</Text>
              <Meta text={meta(c.meta, c.tracks) || ' '} />
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
            <button key={j} className={`alt ${j === d.chosen ? 'is-chosen' : ''}`} onClick={() => onPick(j)}>
              <Cover src={x.img} alt="" round={round} variant="sp" />
              <span className="names"><Text weight="semibold" maxLines={1}>{x.title}</Text><Text type="supporting" maxLines={1}>{x.artists}</Text></span>
              <span className="alt-score">{Math.round(x.score * 100)}</span>
            </button>
          ))}
          <label className="search">
            <span className="visually-hidden">{t.searchLabel}</span>
            <input placeholder={t.searchPlaceholder(d.src.title.slice(0, 16))} />
          </label>
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
    const MAX = 12;          // px the panel may trail behind (was 18)
    const STIFFNESS = 0.06;  // lower = slower return (was 0.14)
    const DAMPING = 0.8;     // velocity kept per frame; lower = less bounce
    const tick = () => {
      vel = (vel - pos * STIFFNESS) * DAMPING;  // spring back toward 0, damped
      pos = Math.max(-MAX, Math.min(MAX, pos + vel));
      el.style.transform = `translate3d(0, ${pos.toFixed(2)}px, 0)`;
      if (Math.abs(pos) > 0.05 || Math.abs(vel) > 0.05) frame = requestAnimationFrame(tick);
      else { el.style.transform = ''; frame = 0; }
    };
    const onScroll = () => {
      if (window.innerWidth <= 1080) return;  // collapsed bottom bar on narrow screens stays still
      const y = window.scrollY;
      vel += Math.max(-4, Math.min(4, -(y - lastY) * 0.08));  // lag behind the scroll direction (was ±6, 0.12)
      lastY = y;
      el.classList.toggle('is-scrolled', y > 40);
      if (!frame) frame = requestAnimationFrame(tick);
    };
    window.addEventListener('scroll', onScroll, {passive: true});
    return () => { window.removeEventListener('scroll', onScroll); cancelAnimationFrame(frame); };
  }, []);
  return ref;
}
