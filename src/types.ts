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
  subjectId?: string
  type: WarningType
  severity: 'error' | 'warning'
  sceneId: string
  title: string
  detail: string
  suggestion: string
}

export interface Reply {
  id: string
  author: string
  text: string
  createdAt: string
  revision: RevisionColor
}

export interface ReviewRecord {
  id: string
  warningId: string
  status: WarningStatus
  revision: RevisionColor
  contentHash: string
  replies: Reply[]
  createdAt: string
  updatedAt: string
}

export interface ReviewThread {
  warningId: string
  records: Record<string, ReviewRecord>
}

export type ReviewMap = Record<string, ReviewThread>

export interface Version {
  id: string
  name: string
  createdAt: string
  script: Script
  reviews: ReviewMap
}

export interface ContinuityState {
  script: Script
  reviews: ReviewMap
  versions: Version[]
  updatedAt: string
}

export interface DiffItem {
  id: string
  sceneNumber: string
  field: string
  before: string
  after: string
}

export interface ReviewConclusionSide {
  exists: boolean
  status: WarningStatus | null
  revision: RevisionColor | null
}

export interface ReviewConclusionDiff {
  id: string
  warningId: string
  title: string
  sceneNumber: string
  changed: boolean
  before: ReviewConclusionSide
  after: ReviewConclusionSide
}
