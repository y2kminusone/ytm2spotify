import {useEffect, useMemo, useState} from 'react';
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
import {Token} from '@astryxdesign/core/Token';
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
const WHY_COLOR = {ok: 'green', warn: 'orange', bad: 'red'} as const;

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
  const [kind, setKind] = useState<Kind>((q.get('tab') as Kind) || 'track');
  const [filter, setFilter] = useState<Filter>((q.get('filter') as Filter) || 'todo');
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

        <div className="summary" aria-live="polite">
          <div className="summary-in">
            <div className="tally">
              <span className="t-accept"><b>{count('accept')}</b> 저장{previewing && bulk.length > 0 && <em> +{bulk.length} 예정</em>}</span>
              <span className="t-preserve"><b>{count('preserve')}</b> 보관</span>
              <span className="t-skip"><b>{count('skip')}</b> 건너뜀</span>
              <span className="t-todo"><b>{count('pending') - (previewing ? bulk.length : 0)}</b> 확인 전</span>
            </div>
            <div className="meter" aria-hidden>
              {(['accept', 'preview', 'preserve', 'skip', 'pending'] as const).map(k => {
                const n = k === 'preview' ? (previewing ? bulk.length : 0) : k === 'pending' ? count('pending') - (previewing ? bulk.length : 0) : count(k);
                return n > 0 ? <span key={k} className={`m-${k}`} style={{flexGrow: n}} /> : null;
              })}
            </div>
          </div>
        </div>

        <main className="main">
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
            <div className="bulk">
              <Slider label="자동 승인 기준 점수" isLabelHidden value={cut} min={0.7} max={1} step={0.01}
                onChange={(v: number) => { setCut(v); setPreviewing(true); }} formatValue={(v: number) => `${Math.round(v * 100)}점`} valueDisplay="text" width={200} />
              <Button label={bulk.length ? `${Math.round(cut * 100)}점 이상 ${bulk.length}개 승인` : '승인할 항목 없음'}
                isDisabled={!bulk.length}
                onClick={() => { setItems(xs => xs.map(d => (bulk.includes(d) ? {...d, decision: 'accept'} : d))); setPreviewing(false); say(`${bulk.length}개를 승인했어요`); }} />
            </div>
          </div>

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

        <footer className="dock">
          <div className="dock-in">
            <div className="keys" aria-hidden>
              <Kbd keys="up" /><Kbd keys="down" /> 이동 <Kbd keys="Y" /> 승인 <Kbd keys="N" /> 건너뛰기 <Kbd keys="P" /> 보관
            </div>
            <Button variant="primary" size="lg" label={`Spotify에 ${count('accept')}개 저장하기`} onClick={() => say('시안이라 여기서 멈춰요. 다음 화면은 저장 진행이에요')} />
          </div>
        </footer>
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
  return (
    <li className={`pair status-${d.status} decision-${d.decision} ${selected ? 'is-selected' : ''} ${willAccept ? 'is-preview' : ''}`} onClick={onSelect}>
      <div className="head">
        <span className="verdict">{STATUS_LABEL[d.status]}</span>
        {score !== null && <span className="match">일치도 {score}%</span>}
        {willAccept && <span className="will-accept">{cutLabel} 이상이라 일괄 승인 대상이에요</span>}
        {d.decision !== 'pending' && <span className="chosen-note">{DECISION_NOTE[d.decision]}</span>}
      </div>
      <div className="side from">
        <Cover src={d.src.img} alt="" round={round} variant="ytm" />
        <div className="names">
          <Text weight="semibold" display="block">{d.src.title}</Text>
          <Text type="supporting" maxLines={1}>{d.src.artists || 'YT Music 구독'}</Text>
          <span className="meta-row">
            {d.src.vt === 'UGC' && <span className="ugc">사용자 업로드</span>}
            {d.src.meta && <Meta text={d.src.meta} />}
          </span>
        </div>
      </div>

      <div className="link" aria-hidden><span className="arrow" /></div>

      <div className="side to">
        {c ? (
          <>
            <Cover src={c.img} alt="" round={round} variant="sp" />
            <div className="names">
              <Text weight="semibold" display="block">{c.title}</Text>
              <Text type="supporting" maxLines={1}>{c.artists || 'Spotify 아티스트'}</Text>
              {c.meta && <span className="meta-row"><Meta text={c.meta} /></span>}
              <div className="why">
                {c.why.filter(([t, k]) => k !== 'ok' && !t.startsWith('사용자 업로드')).map(([t, k]) => <Token key={t} size="sm" label={t} color={WHY_COLOR[k]} />)}
                <span className="why-ok">{c.why.filter(([, k]) => k === 'ok').map(([t]) => t).join(', ')}</span>
              </div>
            </div>
          </>
        ) : (
          <>
            <Cover src={null} alt="" round={round} variant="empty" />
            <div className="names">
              <Text weight="semibold" color="secondary">Spotify에서 찾지 못했어요</Text>
              <Text type="supporting">보관하면 YT Music의 ‘옮기지 못한 곡’ 목록에 모아둬요</Text>
            </div>
          </>
        )}
      </div>

      <div className="decide" onClick={e => e.stopPropagation()}>
        <div className="choices">
        {c && <span className="d d-accept"><ToggleButton size="sm" label="승인" isPressed={d.decision === 'accept'} onPressedChange={() => onDecide('accept')} /></span>}
        <span className="d d-skip"><ToggleButton size="sm" label="건너뛰기" isPressed={d.decision === 'skip'} onPressedChange={() => onDecide('skip')} /></span>
        <span className="d d-preserve"><ToggleButton size="sm" label="보관" isPressed={d.decision === 'preserve'} onPressedChange={() => onDecide('preserve')} /></span>
          <span className="sep" aria-hidden />
          <span className="d d-find"><Button size="sm" variant="ghost" icon={<Icon icon="search" />} label={d.cands.length > 1 ? `다른 후보 ${d.cands.length - 1}개` : '다른 곡 찾기'} onClick={onToggle} /></span>
        </div>
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
