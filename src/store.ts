import { useCallback, useEffect, useRef, useState } from 'react'
import { sampleScript } from './sample'
import type {
  Character,
  ContinuityState,
  DiffItem,
  Prop,
  Reply,
  ReviewConclusionDiff,
  ReviewMap,
  ReviewRecord,
  ReviewThread,
  RevisionColor,
  Scene,
  Script,
  Version,
  Wardrobe,
  WarningItem,
  WarningStatus
} from './types'

const STORAGE_KEY = 'sologsb-1017-constinuity-v1'
const WHITE: RevisionColor = 'white'
const revisionColors: RevisionColor[] = ['white', 'blue', 'pink', 'yellow', 'green', 'goldenrod', 'buff', 'salmon', 'cherry']
function clone<T>(value: T): T { return structuredClone(value) }const id = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`

export const revisionLabels: Record<RevisionColor, string> = {
  white: '白纸版',
  blue: '蓝纸版',
  pink: '粉纸版',
  yellow: '黄纸版',
  green: '绿纸版',
  goldenrod: '金菊版',
  buff: '浅黄版',
  salmon: '鲑粉版',
  cherry: '樱桃版'
}

export interface ReviewContext {
  revision: RevisionColor
  contentHash: string
}

interface Snapshot {
  script: Script
  reviews: ReviewMap
}

function isRevision(value: unknown): value is RevisionColor {
  return typeof value === 'string' && revisionColors.includes(value as RevisionColor)
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  const record = value as Record<string, unknown>
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`
}

function hashContent(value: unknown): string {
  const text = stableStringify(value)
  let hash = 2166136261
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return `h${(hash >>> 0).toString(36)}`
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? value.filter((item): item is T => item && typeof item === 'object') as T[] : []
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function normalizeScript(input: Partial<Script> | undefined, fallback: Script): Script {
  const source = input && typeof input === 'object' ? input : {}
  return {
    title: typeof source.title === 'string' ? source.title : fallback.title,
    writer: typeof source.writer === 'string' ? source.writer : fallback.writer,
    draft: typeof source.draft === 'string' ? source.draft : fallback.draft,
    scenes: asArray<Scene>(source.scenes).map((scene) => ({ ...scene })),
    characters: asArray<Character>(source.characters).map((character) => ({ ...character })),
    props: asArray<Prop>(source.props).map((prop) => ({ ...prop })),
    wardrobes: asArray<Wardrobe>(source.wardrobes).map((wardrobe) => ({ ...wardrobe }))
  }
}

export function getReviewContext(warning: WarningItem, script: Script): ReviewContext {
  const sceneIndex = script.scenes.findIndex((scene) => scene.id === warning.sceneId)
  const scene = script.scenes[sceneIndex]
  const revision = isRevision(scene?.revision) ? scene.revision : WHITE

  if (warning.type === 'character') {
    const character = script.characters.find((item) => item.id === warning.subjectId)
    const introducedAt = character ? script.scenes.findIndex((scene) => scene.id === character.introducedSceneId) : -1
    const appearedBefore = character ? script.scenes.slice(0, Math.max(sceneIndex, 0)).some((item) => item.characterIds.includes(character.id)) : false
    return { revision, contentHash: hashContent({ orderIndex: sceneIndex, introducedAt, appearedBefore, scene, character }) }
  }

  if (warning.type === 'prop') {
    const prop = script.props.find((item) => item.id === warning.subjectId)
    const introducedAt = prop ? script.scenes.findIndex((scene) => scene.id === prop.introducedSceneId) : -1
    return { revision, contentHash: hashContent({ orderIndex: sceneIndex, introducedAt, scene, prop }) }
  }

  if (warning.type === 'wardrobe') {
    const wardrobe = script.wardrobes.find((item) => item.id === warning.subjectId)
    return { revision, contentHash: hashContent({ orderIndex: sceneIndex, scene, wardrobe }) }
  }

  const previousScene = sceneIndex > 0 ? script.scenes[sceneIndex - 1] : undefined
  return { revision, contentHash: hashContent({ orderIndex: sceneIndex, scene, previousScene }) }
}

export function deriveWarnings(script: Script): WarningItem[] {
  const warnings: WarningItem[] = []
  const sceneIndex = (sceneId: string) => script.scenes.findIndex((scene) => scene.id === sceneId)
  const charactersSeen = new Set<string>()
  const propsSeen = new Set<string>()

  script.scenes.forEach((scene, index) => {
    scene.characterIds.forEach((characterId) => {
      const character = script.characters.find((item) => item.id === characterId)
      if (!character) return
      const introducedAt = sceneIndex(character.introducedSceneId)
      if (index > 0 && !charactersSeen.has(characterId) && introducedAt >= index) {
        warnings.push({
          id: `character-${scene.id}-${characterId}`,
          subjectId: characterId,
          type: 'character',
          severity: index > 1 ? 'error' : 'warning',
          sceneId: scene.id,
          title: `${character.name}突然出现`,
          detail: `角色在场景 ${scene.number} 首次出现，但前序场景没有建立其身份、关系或到场铺垫。`,
          suggestion: `在更早场景补充提及、声音或到场动作，并把“首次建立”场景改为相应场次。`
        })
      }
      charactersSeen.add(characterId)
    })

    scene.propIds.forEach((propId) => {
      const prop = script.props.find((item) => item.id === propId)
      if (!prop) return
      const introducedAt = sceneIndex(prop.introducedSceneId)
      if (!propsSeen.has(propId) && introducedAt > index) {
        warnings.push({
          id: `prop-${scene.id}-${propId}`,
          subjectId: propId,
          type: 'prop',
          severity: 'error',
          sceneId: scene.id,
          title: `${prop.name}尚未提前建立`,
          detail: `道具在场景 ${scene.number} 已出现，但首次建立被标记在场景 ${script.scenes[introducedAt]?.number ?? '未知'}。`,
          suggestion: '调整首次建立场景，或在当前场景加入来源、交接动作与持有人反应。'
        })
      }
      propsSeen.add(propId)
    })

    Object.entries(scene.costumes).forEach(([characterId, wardrobeId]) => {
      const wardrobe = script.wardrobes.find((item) => item.id === wardrobeId)
      const character = script.characters.find((item) => item.id === characterId)
      if (!wardrobe || !character) return
      if (!wardrobe.timePeriods.includes(scene.dayNight)) {
        warnings.push({
          id: `wardrobe-${scene.id}-${characterId}-${wardrobeId}`,
          subjectId: wardrobeId,
          type: 'wardrobe',
          severity: 'warning',
          sceneId: scene.id,
          title: `${character.name}服装与时间冲突`,
          detail: `“${wardrobe.name}”只配置用于 ${wardrobe.timePeriods.join('、')}，本场标记为“${scene.dayNight}”。`,
          suggestion: '确认是否跨越时间连续拍摄；如需延续服装，请把当前时段加入服装适用范围。'
        })
      }
    })

    if (index > 0 && script.scenes[index - 1].storyTime && scene.storyTime) {
      const previous = script.scenes[index - 1]
      const previousDay = previous.storyTime.match(/第\s*(\d+)\s*天/)?.[1]
      const currentDay = scene.storyTime.match(/第\s*(\d+)\s*天/)?.[1]
      if (previousDay && currentDay && Number(currentDay) < Number(previousDay)) {
        warnings.push({
          id: `timeline-${scene.id}`,
          type: 'timeline',
          severity: 'error',
          sceneId: scene.id,
          title: '时间线出现倒退',
          detail: `上一场为第 ${previousDay} 天，本场却标记为第 ${currentDay} 天，可能造成观看顺序混乱。`,
          suggestion: '调整故事时间，或明确使用倒叙并在场次摘要中标注时间跳转。'
        })
      }
    }
  })
  return warnings
}

function normalizeReply(input: unknown): Reply {
  const value = asRecord(input)
  const createdAt = typeof value.createdAt === 'string' ? value.createdAt : new Date(0).toISOString()
  return {
    id: typeof value.id === 'string' ? value.id : id('reply'),
    author: typeof value.author === 'string' && value.author.trim() ? value.author : '作者',
    text: typeof value.text === 'string' ? value.text : '',
    createdAt,
    revision: isRevision(value.revision) ? value.revision : WHITE
  }
}

function reviewKey(warningId: string, revision: RevisionColor, contentHash: string) {
  return `${warningId}|${revision}|${contentHash}`
}

function normalizeRecord(warningId: string, input: unknown, context: ReviewContext | undefined, options: { fallbackKey?: string; preferContext?: boolean } = {}): ReviewRecord {
  const { fallbackKey, preferContext = false } = options
  const value = asRecord(input)
  const replies = asArray<unknown>(value.replies).map(normalizeReply)
  const createdAt = typeof value.createdAt === 'string' ? value.createdAt : new Date(0).toISOString()
  const updatedAt = typeof value.updatedAt === 'string' ? value.updatedAt : createdAt
  const status: WarningStatus = value.status === 'accepted' || value.status === 'ignored' || value.status === 'pending' ? value.status : 'pending'
  const keyParts = fallbackKey?.split('|') ?? []
  const revision = isRevision(value.revision)
    ? value.revision
    : isRevision(keyParts[1])
      ? keyParts[1]
      : WHITE
  const contentHash = typeof value.contentHash === 'string' && value.contentHash
    ? value.contentHash
    : keyParts.length >= 3
      ? keyParts.slice(2).join('|')
      : preferContext && context
        ? context.contentHash
        : 'legacy-white'
  return {
    id: typeof value.id === 'string' ? value.id : id('review'),
    warningId: typeof value.warningId === 'string' ? value.warningId : warningId,
    status,
    revision,
    contentHash,
    replies,
    createdAt,
    updatedAt
  }
}

function normalizeReviewMapWithContext(input: unknown, script: Script) {
  const source = asRecord(input)
  const contexts = new Map<string, ReviewContext>(deriveWarnings(script).map((warning) => [warning.id, getReviewContext(warning, script)]))
  const result: ReviewMap = {}

  Object.entries(source).forEach(([threadId, rawThread]) => {
    const threadValue = asRecord(rawThread)
    const warningId = typeof threadValue.warningId === 'string' ? threadValue.warningId : threadId
    const context = contexts.get(warningId)
    const records: Record<string, ReviewRecord> = {}

    if (threadValue.records && typeof threadValue.records === 'object' && !Array.isArray(threadValue.records)) {
      Object.entries(asRecord(threadValue.records)).forEach(([key, rawRecord]) => {
        const record = normalizeRecord(warningId, rawRecord, context, { fallbackKey: key })
        records[reviewKey(warningId, record.revision, record.contentHash)] = record
      })
    } else {
      const record = normalizeRecord(warningId, threadValue, context, { preferContext: true })
      records[reviewKey(warningId, record.revision, record.contentHash)] = record
    }

    if (Object.keys(records).length) result[warningId] = { warningId, records }
  })

  return { result, contexts }
}

export function normalizeReviewMap(input: unknown, script: Script): ReviewMap {
  return normalizeReviewMapWithContext(input, script).result
}

function normalizeVersion(input: unknown, index: number, scriptFallback: Script, legacyReviews: ReviewMap): Version {
  const value = asRecord(input)
  const script = normalizeScript(value.script as Partial<Script>, scriptFallback)
  const hasReviews = Boolean(value.reviews && Object.keys(asRecord(value.reviews)).length)
  const reviews = normalizeReviewMap(hasReviews ? value.reviews : legacyReviews, script)
  return {
    id: typeof value.id === 'string' ? value.id : id('version'),
    name: typeof value.name === 'string' && value.name.trim() ? value.name : `版本 ${index + 1}`,
    createdAt: typeof value.createdAt === 'string' ? value.createdAt : new Date(0).toISOString(),
    script,
    reviews
  }
}

function normalizeState(input: unknown): ContinuityState | null {
  if (!input || typeof input !== 'object') return null
  const parsed = input as Partial<ContinuityState>
  if (!parsed.script || typeof parsed.script !== 'object') return null
  const script = normalizeScript(parsed.script, sampleScript)
  const reviews = normalizeReviewMap(parsed.reviews ?? {}, script)
  const versions = asArray<unknown>(parsed.versions).map((version, index) => normalizeVersion(version, index, script, reviews))
  return {
    script,
    reviews,
    versions,
    updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : new Date().toISOString()
  }
}

function initialState(): ContinuityState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const normalized = normalizeState(JSON.parse(raw))
      if (normalized) return normalized
    }
  } catch {
    // Ignore an invalid local draft and restore the bundled example.
  }
  return { script: clone(sampleScript), reviews: {}, versions: [], updatedAt: new Date().toISOString() }
}

export function diffScript(base: Script, current: Script): DiffItem[] {
  const fields: Array<{ key: keyof Scene; label: string }> = [
    { key: 'slug', label: '场名' },
    { key: 'synopsis', label: '摘要' },
    { key: 'intExt', label: '内外景' },
    { key: 'location', label: '地点' },
    { key: 'dayNight', label: '日夜' },
    { key: 'storyTime', label: '故事时间' },
    { key: 'pageLength', label: '页数' },
    { key: 'revision', label: '修订色' },
    { key: 'status', label: '状态' },
    { key: 'reason', label: '修改理由' }
  ]
  const result: DiffItem[] = []
  const sceneKey = (scene: Scene) => `${scene.number}|${scene.slug}`
  const baseByKey = new Map(base.scenes.map((scene) => [sceneKey(scene), scene]))
  current.scenes.forEach((scene) => {
    const previous = baseByKey.get(sceneKey(scene)) ?? base.scenes.find((item) => item.id === scene.id)
    if (!previous) {
      result.push({ id: `new-${scene.id}`, sceneNumber: scene.number, field: '场次', before: '不存在', after: `${scene.intExt}. ${scene.location} — ${scene.dayNight}` })
      return
    }
    fields.forEach(({ key, label }) => {
      const before = String(previous[key] ?? '')
      const after = String(scene[key] ?? '')
      if (before !== after) result.push({ id: `${scene.id}-${String(key)}`, sceneNumber: scene.number, field: label, before, after })
    })
  })
  base.scenes.forEach((scene) => {
    if (!current.scenes.some((item) => item.id === scene.id || sceneKey(item) === sceneKey(scene))) {
      result.push({ id: `deleted-${scene.id}`, sceneNumber: scene.number, field: '场次', before: `${scene.intExt}. ${scene.location} — ${scene.dayNight}`, after: '已删除' })
    }
  })
  return result
}

export function getActiveReview(thread: ReviewThread | undefined, context: ReviewContext): ReviewRecord | undefined {
  return thread?.records[reviewKey(thread.warningId, context.revision, context.contentHash)]
}

export function diffReviewConclusions(baseScript: Script, currentScript: Script, baseReviews: ReviewMap, currentReviews: ReviewMap): ReviewConclusionDiff[] {
  const baseWarnings = deriveWarnings(baseScript)
  const currentWarnings = deriveWarnings(currentScript)
  const baseById = new Map(baseWarnings.map((warning) => [warning.id, warning]))
  const currentById = new Map(currentWarnings.map((warning) => [warning.id, warning]))
  const warningIds = Array.from(new Set([...baseWarnings.map((warning) => warning.id), ...currentWarnings.map((warning) => warning.id)]))

  const side = (warning: WarningItem | undefined, script: Script, reviews: ReviewMap) => {
    if (!warning) return { exists: false, status: null, revision: null }
    const record = getActiveReview(reviews[warning.id], getReviewContext(warning, script))
    return { exists: true, status: (record?.status ?? 'pending') as WarningStatus, revision: record?.revision ?? null }
  }

  return warningIds.map((warningId) => {
    const beforeWarning = baseById.get(warningId)
    const afterWarning = currentById.get(warningId)
    const before = side(beforeWarning, baseScript, baseReviews)
    const after = side(afterWarning, currentScript, currentReviews)
    const warning = afterWarning ?? beforeWarning
    const scene = currentScript.scenes.find((item) => item.id === warning?.sceneId) ?? baseScript.scenes.find((item) => item.id === warning?.sceneId)
    const changed = before.exists !== after.exists || before.status !== after.status || before.revision !== after.revision
    return {
      id: warningId,
      warningId,
      title: warning?.title ?? '已消失的连续性问题',
      sceneNumber: scene?.number ?? '-',
      changed,
      before,
      after
    }
  }).sort((a, b) => Number(b.changed) - Number(a.changed) || a.title.localeCompare(b.title, 'zh-CN'))
}

function mergeReviews(current: ReviewMap, frozen: ReviewMap): ReviewMap {
  const merged = clone(current)
  Object.entries(frozen).forEach(([warningId, frozenThread]) => {
    const thread = merged[warningId] ?? { warningId, records: {} }
    Object.entries(frozenThread.records).forEach(([key, frozenRecord]) => {
      const currentRecord = thread.records[key]
      if (!currentRecord) {
        thread.records[key] = clone(frozenRecord)
        return
      }
      const repliesById = new Map(currentRecord.replies.map((reply) => [reply.id, reply]))
      frozenRecord.replies.forEach((reply) => {
        if (!repliesById.has(reply.id)) repliesById.set(reply.id, reply)
      })
      thread.records[key] = {
        ...clone(frozenRecord),
        replies: Array.from(repliesById.values()).sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      }
    })
    merged[warningId] = thread
  })
  return merged
}

export function useContinuityStore() {
  const [state, setState] = useState<ContinuityState>(initialState)
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving'>('saved')
  const undoRef = useRef<Snapshot[]>([])
  const redoRef = useRef<Snapshot[]>([])
  const versionsRef = useRef<Version[]>([])
  const saveTimer = useRef<number | undefined>(undefined)

  useEffect(() => {
    versionsRef.current = state.versions
  }, [state.versions])

  useEffect(() => {
    setSaveStatus('saving')
    window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
      setSaveStatus('saved')
    }, 160)
    return () => window.clearTimeout(saveTimer.current)
  }, [state])

  const commit = useCallback((updater: (draft: Snapshot, previous: ContinuityState) => Snapshot) => {
    setState((previous) => {
      const draft = { script: clone(previous.script), reviews: clone(previous.reviews) }
      const next = updater(draft, previous)
      undoRef.current.push({ script: clone(previous.script), reviews: clone(previous.reviews) })
      if (undoRef.current.length > 80) undoRef.current.shift()
      redoRef.current = []
      return { ...previous, ...next, updatedAt: new Date().toISOString() }
    })
  }, [])

  const mutate = useCallback((mutator: (script: Script) => void) => {
    commit((draft) => {
      mutator(draft.script)
      return { script: draft.script, reviews: draft.reviews }
    })
  }, [commit])

  const undo = useCallback(() => {
    setState((previous) => {
      const target = undoRef.current.pop()
      if (!target) return previous
      redoRef.current.push({ script: clone(previous.script), reviews: clone(previous.reviews) })
      return { ...previous, ...target, updatedAt: new Date().toISOString() }
    })
  }, [])

  const redo = useCallback(() => {
    setState((previous) => {
      const target = redoRef.current.pop()
      if (!target) return previous
      undoRef.current.push({ script: clone(previous.script), reviews: clone(previous.reviews) })
      return { ...previous, ...target, updatedAt: new Date().toISOString() }
    })
  }, [])

  const updateScriptField = useCallback((field: 'title' | 'writer' | 'draft', value: string) => {
    mutate((script) => { script[field] = value })
  }, [mutate])

  const updateScene = useCallback((sceneId: string, field: keyof Scene, value: Scene[keyof Scene]) => {
    mutate((script) => {
      const scene = script.scenes.find((item) => item.id === sceneId)
      if (scene) (scene as unknown as Record<string, unknown>)[field] = value
    })
  }, [mutate])

  const toggleSceneRelation = useCallback((sceneId: string, field: 'characterIds' | 'propIds', itemId: string) => {
    mutate((script) => {
      const scene = script.scenes.find((item) => item.id === sceneId)
      if (!scene) return
      const values = scene[field]
      scene[field] = values.includes(itemId) ? values.filter((value) => value !== itemId) : [...values, itemId]
    })
  }, [mutate])

  const setCostume = useCallback((sceneId: string, characterId: string, wardrobeId: string) => {
    mutate((script) => {
      const scene = script.scenes.find((item) => item.id === sceneId)
      if (!scene) return
      if (!wardrobeId) delete scene.costumes[characterId]
      else scene.costumes[characterId] = wardrobeId
    })
  }, [mutate])

  const moveScene = useCallback((sceneId: string, direction: -1 | 1) => {
    mutate((script) => {
      const index = script.scenes.findIndex((scene) => scene.id === sceneId)
      const target = index + direction
      if (index < 0 || target < 0 || target >= script.scenes.length) return
      const [scene] = script.scenes.splice(index, 1)
      script.scenes.splice(target, 0, scene)
    })
  }, [mutate])

  const addScene = useCallback(() => {
    const sceneId = id('scene')
    mutate((script) => {
      const number = String(script.scenes.length + 1)
      script.scenes.push({
        id: sceneId, number, slug: '未命名场景', synopsis: '', intExt: 'INT', location: '待填写', dayNight: '白天', storyTime: `第 1 天`, pageLength: 1,
        characterIds: [], propIds: [], costumes: {}, revision: 'white', status: 'draft', reason: ''
      })
    })
    return sceneId
  }, [mutate])

  const deleteScene = useCallback((sceneId: string) => {
    if (state.script.scenes.length <= 1) return
    mutate((script) => { script.scenes = script.scenes.filter((scene) => scene.id !== sceneId) })
  }, [mutate, state.script.scenes.length])

  const addCharacter = useCallback(() => {
    mutate((script) => {
      script.characters.push({ id: id('char'), name: '新角色', actor: '待定', introducedSceneId: script.scenes[0]?.id ?? '', note: '' })
    })
  }, [mutate])

  const updateCharacter = useCallback((characterId: string, field: keyof Character, value: string) => {
    mutate((script) => {
      const item = script.characters.find((character) => character.id === characterId)
      if (item) item[field] = value
    })
  }, [mutate])

  const addProp = useCallback(() => {
    mutate((script) => {
      script.props.push({ id: id('prop'), name: '新道具', introducedSceneId: script.scenes[0]?.id ?? '', ownerId: script.characters[0]?.id ?? '', note: '' })
    })
  }, [mutate])

  const updateProp = useCallback((propId: string, field: keyof Prop, value: string) => {
    mutate((script) => {
      const item = script.props.find((prop) => prop.id === propId)
      if (item) item[field] = value
    })
  }, [mutate])

  const addWardrobe = useCallback(() => {
    mutate((script) => {
      script.wardrobes.push({ id: id('ward'), characterId: script.characters[0]?.id ?? '', name: '新服装', timePeriods: ['白天'], note: '' })
    })
  }, [mutate])

  const updateWardrobe = useCallback((wardrobeId: string, field: keyof Wardrobe, value: string | string[]) => {
    mutate((script) => {
      const item = script.wardrobes.find((wardrobe) => wardrobe.id === wardrobeId)
      if (item) {
        if (field === 'timePeriods') item.timePeriods = value as string[]
        else item[field] = value as never
      }
    })
  }, [mutate])

  const setReviewStatus = useCallback((warningId: string, status: WarningStatus) => {
    commit((draft) => {
      const warning = deriveWarnings(draft.script).find((item) => item.id === warningId)
      if (warning) {
        const context = getReviewContext(warning, draft.script)
        const key = reviewKey(warningId, context.revision, context.contentHash)
        const thread = draft.reviews[warningId] ?? { warningId, records: {} }
        const current = thread.records[key]
        const timestamp = new Date().toISOString()
        thread.records[key] = current
          ? { ...current, status, updatedAt: timestamp }
          : { id: id('review'), warningId, status, revision: context.revision, contentHash: context.contentHash, replies: [], createdAt: timestamp, updatedAt: timestamp }
        draft.reviews[warningId] = thread
      }
      return { script: draft.script, reviews: draft.reviews }
    })
  }, [commit])

  const addReply = useCallback((warningId: string, author: string, text: string) => {
    const trimmed = text.trim()
    if (!trimmed) return
    commit((draft) => {
      const warning = deriveWarnings(draft.script).find((item) => item.id === warningId)
      if (warning) {
        const context = getReviewContext(warning, draft.script)
        const key = reviewKey(warningId, context.revision, context.contentHash)
        const thread = draft.reviews[warningId] ?? { warningId, records: {} }
        const timestamp = new Date().toISOString()
        const current = thread.records[key]
        const reply: Reply = { id: id('reply'), author: author.trim() || '作者', text: trimmed, createdAt: timestamp, revision: context.revision }
        thread.records[key] = current
          ? { ...current, replies: [...current.replies, reply], updatedAt: timestamp }
          : { id: id('review'), warningId, status: 'pending', revision: context.revision, contentHash: context.contentHash, replies: [reply], createdAt: timestamp, updatedAt: timestamp }
        draft.reviews[warningId] = thread
      }
      return { script: draft.script, reviews: draft.reviews }
    })
  }, [commit])

  const createVersion = useCallback((name: string) => {
    const versionId = id('version')
    const createdAt = new Date().toISOString()
    let created: Version | undefined
    setState((previous) => {
      const version: Version = {
        id: versionId,
        name: name.trim() || `版本 ${previous.versions.length + 1}`,
        createdAt,
        script: clone(previous.script),
        reviews: clone(previous.reviews)
      }
      created = version
      versionsRef.current = [version, ...versionsRef.current]
      return { ...previous, versions: versionsRef.current, updatedAt: new Date().toISOString() }
    })
    return created as Version
  }, [])

  const restoreVersion = useCallback((versionId: string) => {
    commit((draft, previous) => {
      const version = versionsRef.current.find((item) => item.id === versionId)
      if (!version) return { script: draft.script, reviews: draft.reviews }
      return { script: clone(version.script), reviews: mergeReviews(draft.reviews, version.reviews) }
    })
  }, [commit])

  const reset = useCallback(() => {
    commit(() => ({ script: clone(sampleScript), reviews: {} }))
  }, [commit])

  return {
    state,
    saveStatus,
    warnings: deriveWarnings(state.script),
    updateScriptField,
    updateScene,
    toggleSceneRelation,
    setCostume,
    moveScene,
    addScene,
    deleteScene,
    addCharacter,
    updateCharacter,
    addProp,
    updateProp,
    addWardrobe,
    updateWardrobe,
    setReviewStatus,
    addReply,
    createVersion,
    restoreVersion,
    undo,
    redo,
    reset
  }
}
