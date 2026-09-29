export type RevisionColor = 'white' | 'blue' | 'pink' | 'yellow' | 'green' | 'goldenrod' | 'buff' | 'salmon' | 'cherry'
export type WarningStatus = 'pending' | 'accepted' | 'ignored'
export type WarningType = 'character' | 'prop' | 'wardrobe' | 'timeline'

export interface Character {
  id: string
  name: string
  actor: string
  introducedSceneId: string
  note: string
}

export interface Prop {
  id: string
  name: string
  introducedSceneId: string
  ownerId: string
  note: string
}

export interface Wardrobe {
  id: string
  characterId: string
  name: string
  timePeriods: string[]
  note: string
}

export interface Scene {
  id: string
  number: string
  slug: string
  synopsis: string
  intExt: 'INT' | 'EXT' | 'INT/EXT'
  location: string
  dayNight: string
  storyTime: string
  pageLength: number
  characterIds: string[]
  propIds: string[]
  costumes: Record<string, string>
  revision: RevisionColor
  status: 'draft' | 'review' | 'locked'
  reason: string
}

export interface Script {
  title: string
  writer: string
  draft: string
  scenes: Scene[]
  characters: Character[]
  props: Prop[]
  wardrobes: Wardrobe[]
}

export interface WarningItem {
  id: string
  type: WarningType
  severity: 'error' | 'warning'
  sceneId: string
  title: string
  detail: string
  suggestion: string
  /** 影响该警告判断的剧本内容指纹，内容或修订色变化后旧结论失效。 */
  signature: string
}

export interface Reply {
  id: string
  author: string
  text: string
  createdAt: string
}

/** 一轮审阅判断：结论、回复都绑定到作出判断时的修订色与内容指纹。 */
export interface ReviewRound {
  revision: RevisionColor
  signature: string
  status: WarningStatus
  decidedAt: string
  backfilled?: boolean
  replies: Reply[]
}

export interface WarningReview {
  /** 已失效的历史轮次，按时间正序保存，回复留作上一版说明。 */
  history: ReviewRound[]
  /** 当前轮次；结论有效时状态为已接受/已忽略，内容变化后回到待审。 */
  current: ReviewRound
}

export interface Version {
  id: string
  name: string
  createdAt: string
  script: Script
  /** 保存版本时冻结的审阅状态，恢复后原样显示当时的判断。 */
  reviews: Record<string, WarningReview>
}

export interface ContinuityState {
  script: Script
  reviews: Record<string, WarningReview>
  versions: Version[]
  updatedAt: string
}

export interface DiffItem {
  id: string
  kind: 'scene' | 'review'
  sceneNumber: string
  field: string
  before: string
  after: string
  /** 审阅结论行：两端各自绑定的修订色与结论。 */
  review?: {
    warningTitle: string
    beforeRevision: RevisionColor | null
    afterRevision: RevisionColor | null
  }
}
