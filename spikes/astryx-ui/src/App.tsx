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
import sample from './sample.json';
import './App.css';

type Kind = 'album' | 'artist' | 'track';
type Status = 'auto' | 'review' | 'substitute' | 'not_found' | 'exists';
type Decision = 'pending' | 'accept' | 'skip' | 'preserve';
type Why = [string, 'ok' | 'warn' | 'bad'];
interface Cand {title: string; artists: string; img: string | null; meta: string; score: number; why: Why[]}
interface Item {
  id: number; kind: Kind; status: Status; chosen: number; decision: Decision;
  src: {title: string; artists: string; meta: string; img: string | null; vt?: string; group?: string | null};
  cands: Cand[];
}

const INITIAL: Record<Status, Decision> = {auto: 'accept', exists: 'skip', not_found: 'preserve', review: 'pending', substitute: 'pending'};
const KIND_LABEL: Record<Kind, string> = {album: '앨범', artist: '아티스트', track: '좋아요 곡'};
const STATUS_LABEL: Record<Status, string> = {review: '확인 필요', substitute: '다른 버전', auto: '자동으로 맞춤', not_found: 'Spotify에 없음', exists: '이미 있음'};
const FILTERS = ['todo', 'auto', 'not_found', 'exists', 'all'] as const;
type Filter = (typeof FILTERS)[number];
const FILTER_LABEL: Record<Filter, string> = {todo: '확인 필요', auto: '자동으로 맞춤', not_found: 'Spotify에 없음', exists: '이미 있음', all: '전체'};
const DECISION_NOTE: Record<Decision, string> = {pending: '', accept: 'Spotify에 저장할게요', skip: '옮기지 않아요', preserve: 'YT Music 보관 목록에 모아둘게요'};

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
  const [items, setItems] = useState(initialItems);
  const [kind, setKind] = useState<Kind>(() => (q.get('tab') as Kind) in KIND_LABEL ? (q.get('tab') as Kind) : 'track');
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
    <Theme theme={neutralTheme} mode="light">
      <div className="page">
        <header className="top">
          <div className="brand"><span className="mark" aria-hidden />ytm2spotify</div>
          <div className="stepper">
            <Stepper activeStep={3} density="compact" horizontalOptions={{minimumStepWidth: 84, collapsedVariant: 'withLabel'}}>
              {['연결', '불러오기', '매칭', '검토', '저장', '결과'].map((l, i) => <Step key={l} step={i} label={l} />)}
            </Stepper>
          </div>
        </header>

        <div className="shell">
        <div className="lead">
          <section className="intro">
            <Heading level={1}>
              {todo.length ? `${KIND_LABEL[kind]} ${todo.length}개만 확인해 주세요` : `${KIND_LABEL[kind]}는 확인할 게 없어요`}
            </Heading>
            <Text type="large" color="secondary" as="p">
              {KIND_LABEL[kind]} {total.toLocaleString()}개 중 나머지는 자동으로 맞췄어요. 확인이 끝나면 아래에서 한 번에 저장해요.
            </Text>
            <Text type="supporting" as="p">시안이에요. 실제 보관함의 일부만 샘플로 넣었어요.</Text>
          </section>

          <TabList value={kind} onChange={v => { setKind(v as Kind); setSel(0); setOpen(null); setPreviewing(false); }} hasDivider size="lg">
            {(Object.keys(KIND_LABEL) as Kind[]).map(k => (
              <Tab key={k} value={k} label={KIND_LABEL[k]}
                endContent={<span className="tab-count">{(sample.totals as Record<Kind, number>)[k].toLocaleString()}</span>} />
            ))}
          </TabList>

          <div className="toolbar">
            <SegmentedControl label="상태로 보기" value={filter} onChange={v => { setFilter(v as Filter); setSel(0); }}>
              {FILTERS.map(f => (
                <SegmentedControlItem key={f} value={f} label={`${FILTER_LABEL[f]} ${inKind.filter(d => matchesFilter(d, f)).length}`} />
              ))}
            </SegmentedControl>
          </div>

        </div>

        <main className="main">
          {group.length >= 2 && (
            <div className="group-hint">
              <div>
                <Text weight="semibold" as="p" display="block">리믹스 영상 {group.length}개가 비슷해요</Text>
                <Text type="supporting" as="p" display="block">원곡이 Spotify에 있으면 원곡으로, 없으면 YT Music 보관 목록에 모아둘 수 있어요.</Text>
              </div>
              <div className="banner-actions">
                <Button size="sm" label="모두 보관" onClick={() => { setItems(xs => xs.map(d => (d.src.group ? {...d, decision: 'preserve'} : d))); say('리믹스를 보관 목록으로 옮겼어요'); }} />
                <Button size="sm" label="원곡으로 대체" onClick={() => { setItems(xs => xs.map(d => (d.src.group ? {...d, decision: d.cands.length ? 'accept' : 'preserve'} : d))); say('원곡이 있는 곡은 대체하고 나머지는 보관했어요'); }} />
              </div>
            </div>
          )}

          <ol className="pairs">
            {rows.length === 0 && <li className="empty"><Text color="secondary">이 조건에 맞는 항목이 없어요</Text></li>}
            {rows.map((d, i) => (
              <PairRow key={d.id} d={d} selected={i === sel} willAccept={previewing && bulk.includes(d)} cutLabel={`${Math.round(cut * 100)}점`} isOpen={open === d.id}
                onSelect={() => setSel(i)} onToggle={() => setOpen(o => (o === d.id ? null : d.id))}
                onDecide={k => decide(d.id, k)}
                onPick={j => { setItems(xs => xs.map(x => (x.id === d.id ? {...x, chosen: j, decision: 'accept'} : x))); say('후보를 바꾸고 승인했어요'); }} />
            ))}
          </ol>
        </main>

        <aside ref={panelRef} className="side-panel" aria-label="진행 상황과 저장">
          <section className="panel-block progress" aria-live="polite">
            <Text type="supporting" display="block">진행 상황</Text>
            <p className="progress-headline">
              {count('pending') - previewN > 0 ? <>확인할 항목이 <b>{count('pending') - previewN}개</b> 남았어요</> : <>모두 확인했어요</>}
            </p>
            <div className="meter" aria-hidden>
              {(['accept', 'preview', 'preserve', 'skip', 'pending'] as const).map(k => {
                const n = k === 'preview' ? previewN : k === 'pending' ? count('pending') - previewN : count(k);
                return n > 0 ? <span key={k} className={`m-${k}`} style={{flexGrow: n}} /> : null;
              })}
            </div>
            <dl className="tally">
              <div className="t-accept"><dt><i className="m-accept" />저장</dt><dd>{count('accept')}{previewN > 0 && <em>+{previewN}</em>}</dd></div>
              <div><dt><i className="m-preserve" />보관</dt><dd>{count('preserve')}</dd></div>
              <div><dt><i className="m-skip" />건너뜀</dt><dd>{count('skip')}</dd></div>
              <div className="t-todo"><dt><i className="m-pending" />확인 전</dt><dd>{count('pending') - previewN}</dd></div>
            </dl>
            <Button variant="primary" size="lg" width="100%" label={`Spotify에 ${count('accept')}개 저장하기`} onClick={() => say('시안이라 여기서 멈춰요. 다음 화면은 저장 진행이에요')} />
            {count('pending') > 0 && <Text type="supporting" display="block">확인 전 항목은 저장하지 않고 남겨둬요</Text>}
          </section>

          <section className="panel-block">
            <Text weight="semibold" display="block">한 번에 승인</Text>
            <Text type="supporting" display="block">기준 점수를 움직이면 목록에서 바로 미리 보여줘요.</Text>
            <Slider label="일괄 승인 기준 점수" isLabelHidden value={cut} min={0.7} max={1} step={0.01}
              onChange={(v: number) => { setCut(v); setPreviewing(true); }} formatValue={(v: number) => `${Math.round(v * 100)}점`} valueDisplay="text" width="100%" />
            <Button width="100%" label={bulk.length ? `${Math.round(cut * 100)}점 이상 ${bulk.length}개 승인` : '기준을 넘는 항목이 없어요'}
              isDisabled={!bulk.length}
              onClick={() => { setItems(xs => xs.map(d => (bulk.includes(d) ? {...d, decision: 'accept'} : d))); setPreviewing(false); say(`${bulk.length}개를 승인했어요`); }} />
          </section>

          <details className="panel-keys">
            <summary>키보드 단축키</summary>
            <ul>
              <li><span><Kbd keys="up" /><Kbd keys="down" /></span>이동</li>
              <li><Kbd keys="Y" />승인</li>
              <li><Kbd keys="N" />건너뛰기</li>
              <li><Kbd keys="P" />보관</li>
              <li><Kbd keys="enter" />다른 후보 보기</li>
            </ul>
          </details>
        </aside>
        </div>
        {toast && <div className="toast" role="status">{toast}</div>}
      </div>
    </Theme>
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

// 받침 있으면 '이라', 없으면 '라' (한글이 아니면 '이라')
function iraJosa(word: string) {
  const ch = word.trim().slice(-1).charCodeAt(0);
  if (ch < 0xac00 || ch > 0xd7a3) return '이라';
  return (ch - 0xac00) % 28 ? '이라' : '라';
}

function Meta({text}: {text: string}) {
  const parts = text.split(' · ').filter(Boolean);
  return <span className="meta">{parts.map(p => <span key={p}>{p}</span>)}</span>;
}

function PairRow({d, selected, willAccept, cutLabel, isOpen, onSelect, onToggle, onDecide, onPick}: {
  d: Item; selected: boolean; willAccept: boolean; cutLabel: string; isOpen: boolean; onSelect: () => void; onToggle: () => void;
  onDecide: (k: Decision) => void; onPick: (j: number) => void;
}) {
  const c = d.cands[d.chosen];
  const round = d.kind === 'artist';
  const score = c ? Math.round(c.score * 100) : null;
  // problems first, then what matched; the upload badge lives here too so both sides stay symmetric
  const rank = {bad: 0, warn: 1, ok: 2} as const;
  const isVariant = (t: string) => /커버|리믹스|다른 버전/.test(t);
  const variant = c?.why.find(([t]) => isVariant(t))?.[0].replace(/^다른 버전 \((.*)\)$/, '$1');
  const reasons: Why[] = [
    ...(d.src.vt === 'UGC' ? [['사용자 업로드 영상', 'warn'] as Why] : []),
    ...(c?.why.filter(([t]) => !t.startsWith('사용자 업로드') && !isVariant(t) && t !== '원곡으로 대체') ?? []),
  ].sort((a, b) => rank[a[1]] - rank[b[1]]);
  return (
    <li className={`pair status-${d.status} decision-${d.decision} ${selected ? 'is-selected' : ''} ${willAccept ? 'is-preview' : ''}`} onClick={onSelect}>
      <div className="head">
        <span className="verdict">{STATUS_LABEL[d.status]}</span>
        {score !== null && <span className="match">일치도 {score}%</span>}
        {d.status === 'substitute' && variant && <span className="variant-note">{variant}{iraJosa(variant)} 원곡으로 대체해요</span>}
        {willAccept && <span className="will-accept">{cutLabel} 이상이라 일괄 승인 대상이에요</span>}
        {d.decision !== 'pending' && <span className="chosen-note">{DECISION_NOTE[d.decision]}</span>}
      </div>
      <div className="compare">
        <Cover src={d.src.img} alt="" round={round} variant="ytm" />
        <div className="names from">
          <Text weight="semibold" maxLines={2}>{d.src.title}</Text>
          <Text type="supporting" maxLines={1}>{d.src.artists || 'YT Music 구독'}</Text>
          <Meta text={d.kind === 'track' && d.src.meta && !d.src.meta.includes(' · ') ? `앨범 정보 없음 · ${d.src.meta}` : d.src.meta || ' '} />
        </div>
        <div className="link" aria-hidden><span className="arrow" /></div>
        <Cover src={c?.img ?? null} alt="" round={round} variant={c ? 'sp' : 'empty'} />
        <div className="names to">
          {c ? (
            <>
              <Text weight="semibold" maxLines={2}>{c.title}</Text>
              <Text type="supporting" maxLines={1}>{c.artists || 'Spotify 아티스트'}</Text>
              <Meta text={c.meta || ' '} />
            </>
          ) : (
            <>
              <Text weight="semibold" color="secondary">Spotify에서 찾지 못했어요</Text>
              <Text type="supporting">보관하면 YT Music의 ‘옮기지 못한 곡’ 목록에 모아둬요</Text>
              <span />
            </>
          )}
        </div>
      </div>

      <div className="decide" onClick={e => e.stopPropagation()}>
        <div className="choices">
        {c && <span className="d d-accept"><ToggleButton size="sm" label="승인" isPressed={d.decision === 'accept'} onPressedChange={() => onDecide('accept')} /></span>}
        <span className="d d-skip"><ToggleButton size="sm" label="건너뛰기" isPressed={d.decision === 'skip'} onPressedChange={() => onDecide('skip')} /></span>
        <span className="d d-preserve"><ToggleButton size="sm" label="보관" isPressed={d.decision === 'preserve'} onPressedChange={() => onDecide('preserve')} /></span>
          <span className="sep" aria-hidden />
          <span className="d d-find"><Button size="sm" variant="ghost" icon={<Icon icon="search" />} label={d.cands.length > 1 ? `다른 후보 ${d.cands.length - 1}개` : '다른 곡 찾기'} onClick={onToggle} /></span>
        </div>
        {reasons.length > 0 && (
          <ul className="reasons" aria-label="판단 근거">
          {reasons.map(([t, k]) => (
            <li key={t} className={`reason r-${k}`}><span className="r-icon" aria-hidden>{k === 'ok' ? '✓' : '!'}</span>{t}</li>
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
            <span className="visually-hidden">Spotify에서 직접 검색</span>
            <input placeholder={`Spotify에서 직접 검색 (예: ${d.src.title.slice(0, 16)})`} />
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
