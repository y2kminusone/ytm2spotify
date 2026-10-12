// App copy in one place. Korean is the source language; English mirrors it key for key.
// Messages that need numbers or grammar are functions, so each language can handle
// its own plurals (English) or particles (Korean) instead of string concatenation.

export type Lang = 'ko' | 'en';
export const LANGS: Lang[] = ['ko', 'en'];

type Kind = 'album' | 'artist' | 'track';
type Status = 'auto' | 'review' | 'substitute' | 'not_found' | 'exists';
type Decision = 'pending' | 'accept' | 'skip' | 'preserve';
type Filter = 'todo' | 'accept' | 'preserve' | 'skip' | 'all';

// Korean particle: '이라' after a final consonant, '라' after a vowel ('이라' for non-Hangul).
function ira(word: string) {
  const ch = word.trim().slice(-1).charCodeAt(0);
  if (ch < 0xac00 || ch > 0xd7a3) return '이라';
  return (ch - 0xac00) % 28 ? '이라' : '라';
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

const ko = {
  langName: '한국어',
  steps: ['연결', '불러오기', '매칭', '검토', '저장', '결과'],
  kind: {album: '앨범', artist: '아티스트', track: '좋아요 곡'} as Record<Kind, string>,
  status: {review: '확인 필요', substitute: '다른 버전', auto: '자동으로 맞춤', not_found: 'Spotify에 없음', exists: '이미 있음'} as Record<Status, string>,
  filter: {todo: '확인 전', accept: '저장 예정', preserve: '보관', skip: '건너뜀', all: '전체'} as Record<Filter, string>,
  decisionNote: {pending: '', accept: 'Spotify에 저장할게요', skip: '옮기지 않아요', preserve: 'YT Music 보관 목록에 모아둘게요'} as Record<Decision, string>,

  headline: (kind: string, n: number) => (n ? `${kind} ${n}개만 확인해 주세요` : `${kind}는 확인할 게 없어요`),
  lede: (kind: string, total: number) => `${kind} ${total.toLocaleString('ko')}개 중 나머지는 자동으로 맞췄어요. 확인이 끝나면 한 번에 저장해요.`,
  prototypeNote: '시안이에요. 실제 보관함의 일부만 샘플로 넣었어요.',
  filterLabel: '상태로 보기',
  empty: '이 조건에 맞는 항목이 없어요',

  groupTitle: (n: number) => `리믹스 영상 ${n}개가 비슷해요`,
  groupBody: '원곡이 Spotify에 있으면 원곡으로, 없으면 YT Music 보관 목록에 모아둘 수 있어요.',
  groupKeepAll: '모두 보관',
  groupReplace: '원곡으로 대체',
  toastGroupKept: '리믹스를 보관 목록으로 옮겼어요',
  toastGroupReplaced: '원곡이 있는 곡은 대체하고 나머지는 보관했어요',
  toastPicked: '후보를 바꾸고 승인했어요',

  match: (score: number) => `일치도 ${score}%`,
  variantNote: (v: string) => `${v}${ira(v)} 원곡으로 대체해요`,
  willAccept: (cut: number) => `${cut}점 이상이라 일괄 승인 대상이에요`,
  ytmSubscribed: 'YT Music 구독',
  spotifyArtist: 'Spotify 아티스트',
  noAlbum: '앨범 정보 없음',
  trackCount: (n: number) => `${n}곡`,
  notFoundTitle: 'Spotify에서 찾지 못했어요',
  notFoundBody: '보관하면 YT Music의 ‘옮기지 못한 곡’ 목록에 모아둬요',

  accept: '승인', skip: '건너뛰기', keep: '보관',
  otherCands: (n: number) => `다른 후보 ${n}개`,
  findOther: '다른 곡 찾기',
  reasonsLabel: '판단 근거',
  searchLabel: 'Spotify에서 직접 검색',
  searchPlaceholder: (ex: string) => `Spotify에서 직접 검색 (예: ${ex})`,

  panelLabel: '진행 상황과 저장',
  progress: '진행 상황',
  remaining: (n: number) => (n > 0 ? ['확인할 항목이 ', `${n}개`, ' 남았어요'] : ['', '', '모두 확인했어요']),
  tally: {accept: '저장', preserve: '보관', skip: '건너뜀', pending: '확인 전'},
  save: (n: number) => `Spotify에 ${n}개 저장하기`,
  saveNote: '확인 전 항목은 저장하지 않고 남겨둬요',
  toastSave: '시안이라 여기서 멈춰요. 다음 화면은 저장 진행이에요',
  bulkTitle: '한 번에 승인',
  bulkBody: '기준 점수를 움직이면 목록에서 바로 미리 보여줘요.',
  bulkSlider: '일괄 승인 기준 점수',
  points: (n: number) => `${n}점`,
  bulkButton: (cut: number, n: number) => (n ? `${cut}점 이상 ${n}개 승인` : '기준을 넘는 항목이 없어요'),
  toastBulk: (n: number) => `${n}개를 승인했어요`,
  shortcuts: '키보드 단축키',
  keys: {move: '이동', accept: '승인', skip: '건너뛰기', keep: '보관', alts: '다른 후보 보기'},

  loading: '불러오는 중…',
  loadError: (e: string) => `서버에 연결하지 못했어요: ${e}`,
  emptyLibrary: '아직 매칭된 항목이 없어요. 터미널에서 `ytm2spotify sync`와 `ytm2spotify match`를 먼저 실행해 주세요.',
  unavailable: (n: number) => (n ? `YT Music에서 재생할 수 없는 곡 ${n}개는 정보를 받을 수 없어 제외했어요.` : ''),
  applied: 'Spotify에 저장됨',
  applyFailed: '저장 실패',
  confirmTitle: (n: number) => `Spotify에 ${n}개를 저장할까요?`,
  confirmBody: '내 Spotify 보관함에 추가돼요. 나중에 `ytm2spotify undo`로 되돌릴 수 있어요.',
  confirmAll: '모두 저장',
  confirmTrial: '앨범 5개만 먼저 저장해 보기',
  cancel: '취소',
  saving: '저장하는 중…',
  savedResult: (ok: number, failed: number) => (failed ? `${ok}개 저장, ${failed}개 실패` : `${ok}개를 저장했어요`),
  nothingToSave: '저장할 항목이 없어요',
  preserveTitle: '옮기지 못한 곡 보관',
  preserveBody: (n: number) => `보관하기로 한 곡 ${n}개를 YT Music 비공개 플레이리스트로 모아둬요.`,
  preserveButton: 'YT Music에 보관 목록 만들기',
  preserveDone: (n: number) => `YT Music에 ${n}곡짜리 보관 목록을 만들었어요`,
  preserveOpen: '보관 목록 열기',
  csv: 'CSV로 내려받기',
  dupLibrary: '원곡이 이미 내 Spotify에 있어요 (다시 저장하지 않아요)',
  dupOther: '같은 곡이 다른 항목으로도 저장 예정이에요 (한 번만 저장돼요)',
  alreadyCount: (n: number) => `${n}개는 이미 있어서 건너뜀`,
  searching: '검색하는 중…',
  noResults: '검색 결과가 없어요',

  ugc: '사용자 업로드 영상',
  reason: {
    album_title_match: '앨범명 일치', artist_match: '아티스트 일치', year_match: '연도 일치',
    already_saved: '이미 내 Spotify에 있음', alias_match: '별칭으로 일치', romanized_artist: '아티스트 로마자 표기',
    track_count_match: '트랙 수 일치', name_match: '이름 일치', top_result: '검색 1위',
    title_match: '제목 일치', album_match: '앨범 일치', artist_from_title: '제목에서 아티스트 추출',
    length_diff: (n: number) => `길이 ${n}초 차`,
    title_differs: '제목 다름', artist_differs: '아티스트 다름', year_differs: (y: number) => `발매연도 ${y}`, name_differs: '이름 다름',
  },
  variant: {cover: '커버곡', remix: '리믹스', live: '라이브 영상', speed: '속도 변형', version: '다른 버전'} as Record<string, string>,
  groupTitleOf: (v: string, n: number) => `${v} ${n}개가 비슷해요`,
};

type Messages = typeof ko;

const en: Messages = {
  langName: 'English',
  steps: ['Connect', 'Load', 'Match', 'Review', 'Save', 'Done'],
  kind: {album: 'Albums', artist: 'Artists', track: 'Liked songs'},
  status: {review: 'Needs a look', substitute: 'Different version', auto: 'Matched', not_found: 'Not on Spotify', exists: 'Already saved'},
  filter: {todo: 'To check', accept: 'To save', preserve: 'Keep', skip: 'Skipped', all: 'All'},
  decisionNote: {pending: '', accept: 'Will save to Spotify', skip: "Won't move", preserve: 'Will keep in a YT Music list'},

  headline: (kind, n) => (n ? `Just ${n} ${kind.toLowerCase()} to check` : `No ${kind.toLowerCase()} to check`),
  lede: (kind, total) => `We matched the rest of your ${total.toLocaleString('en')} ${kind.toLowerCase()} automatically. Save them all at once when you're done.`,
  prototypeNote: 'This is a prototype with a small sample of a real library.',
  filterLabel: 'Filter by status',
  empty: 'Nothing matches this filter',

  groupTitle: n => `${n} similar remix videos`,
  groupBody: "Replace them with the originals where Spotify has them, or keep them in a YT Music list.",
  groupKeepAll: 'Keep all',
  groupReplace: 'Use originals',
  toastGroupKept: 'Kept the remixes in your YT Music list',
  toastGroupReplaced: 'Used originals where found and kept the rest',
  toastPicked: 'Switched to that match and approved it',

  match: score => `${score}% match`,
  variantNote: v => `${v[0].toUpperCase()}${v.slice(1)}, so we'll use the original`,
  willAccept: cut => `Scores ${cut}+, included in bulk approve`,
  ytmSubscribed: 'Subscribed on YT Music',
  spotifyArtist: 'Spotify artist',
  noAlbum: 'No album info',
  trackCount: n => `${n} ${plural(n, 'track', 'tracks')}`,
  notFoundTitle: "Couldn't find it on Spotify",
  notFoundBody: "Keep it and we'll add it to a “Couldn't move” list on YT Music",

  accept: 'Approve', skip: 'Skip', keep: 'Keep',
  otherCands: n => `${n} other ${plural(n, 'match', 'matches')}`,
  findOther: 'Find another',
  reasonsLabel: 'Why',
  searchLabel: 'Search Spotify',
  searchPlaceholder: ex => `Search Spotify (e.g. ${ex})`,

  panelLabel: 'Progress and save',
  progress: 'Progress',
  remaining: n => (n > 0 ? ['', `${n} ${plural(n, 'item', 'items')}`, ' left to check'] : ['', '', 'All checked']),
  tally: {accept: 'Save', preserve: 'Keep', skip: 'Skip', pending: 'To check'},
  save: n => `Save ${n} to Spotify`,
  saveNote: "Items you haven't checked won't be saved",
  toastSave: 'Prototype stops here. Next is the save screen.',
  bulkTitle: 'Approve in bulk',
  bulkBody: 'Move the score and the list previews what gets approved.',
  bulkSlider: 'Bulk approve score',
  points: n => `${n}`,
  bulkButton: (cut, n) => (n ? `Approve ${n} scoring ${cut}+` : 'Nothing above this score'),
  toastBulk: n => `Approved ${n}`,
  shortcuts: 'Keyboard shortcuts',
  keys: {move: 'Move', accept: 'Approve', skip: 'Skip', keep: 'Keep', alts: 'Other matches'},

  loading: 'Loading…',
  loadError: e => `Couldn't reach the server: ${e}`,
  emptyLibrary: 'Nothing matched yet. Run `ytm2spotify sync` and `ytm2spotify match` in the terminal first.',
  unavailable: n => (n ? `${n} liked ${plural(n, 'song is', 'songs are')} unavailable on YT Music and couldn't be read.` : ''),
  applied: 'Saved to Spotify',
  applyFailed: "Couldn't save",
  confirmTitle: n => `Save ${n} to Spotify?`,
  confirmBody: 'They will be added to your Spotify library. You can undo with `ytm2spotify undo`.',
  confirmAll: 'Save all',
  confirmTrial: 'Try 5 albums first',
  cancel: 'Cancel',
  saving: 'Saving…',
  savedResult: (ok, failed) => (failed ? `Saved ${ok}, ${failed} failed` : `Saved ${ok}`),
  nothingToSave: 'Nothing to save',
  preserveTitle: "Keep what didn't move",
  preserveBody: n => `Put the ${n} ${plural(n, 'song', 'songs')} you chose to keep into a private YT Music playlist.`,
  preserveButton: 'Create YT Music playlist',
  preserveDone: n => `Created a YT Music playlist with ${n} ${plural(n, 'song', 'songs')}`,
  preserveOpen: 'Open playlist',
  csv: 'Download CSV',
  dupLibrary: "Already in your Spotify (won't be saved again)",
  dupOther: 'Another item saves the same track (saved once)',
  alreadyCount: n => `${n} already there`,
  searching: 'Searching…',
  noResults: 'No results',

  ugc: 'User upload',
  reason: {
    album_title_match: 'Album title matches', artist_match: 'Artist matches', year_match: 'Year matches',
    already_saved: 'Already in your Spotify', alias_match: 'Matched by alias', romanized_artist: 'Romanized artist name',
    track_count_match: 'Track count matches', name_match: 'Name matches', top_result: 'Top search result',
    title_match: 'Title matches', album_match: 'Album matches', artist_from_title: 'Artist taken from title',
    length_diff: n => `${n}s length difference`,
    title_differs: 'Title differs', artist_differs: 'Artist differs', year_differs: y => `Released ${y}`, name_differs: 'Name differs',
  },
  variant: {cover: 'cover', remix: 'remix', live: 'live video', speed: 'sped-up/slowed', version: 'alternate version'},
  groupTitleOf: (v, n) => `${n} similar ${v}${n === 1 ? '' : 's'}`,
};

export const MESSAGES: Record<Lang, Messages> = {ko, en};

export function detectLang(): Lang {
  const fromUrl = new URLSearchParams(location.search).get('lang');
  if (fromUrl === 'ko' || fromUrl === 'en') return fromUrl;
  try {
    const saved = localStorage.getItem('lang');
    if (saved === 'ko' || saved === 'en') return saved;
  } catch { /* storage blocked: fall through */ }
  return navigator.language.toLowerCase().startsWith('ko') ? 'ko' : 'en';
}

export function saveLang(lang: Lang) {
  try { localStorage.setItem('lang', lang); } catch { /* ignore */ }
}

// Reason codes come from the matcher as [code, level, param?]
export function reasonText(t: Messages, code: string, param?: string | number): string {
  if (code === 'length_diff') return t.reason.length_diff(Number(param));
  if (code === 'year_differs') return t.reason.year_differs(Number(param));
  if (code.startsWith('variant:')) return variantText(t, code);
  const r = (t.reason as Record<string, unknown>)[code];
  return typeof r === 'string' ? r : code;
}

export function variantText(t: Messages, code: string): string {
  const kind = code.split(':')[1];
  return t.variant[kind] ?? kind;
}
