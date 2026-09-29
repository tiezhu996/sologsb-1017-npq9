import { useCallback, useEffect, useRef, useState } from 'react'
import { sampleScript } from './sample'
import type { Character, ContinuityState, DiffItem, Prop, Reply, RevisionColor, Scene, Script, Version, Wardrobe, WarningItem, WarningReview, WarningStatus, ReviewRound } from './types'

const STORAGE_KEY = 'sologsb-1017-continuity-v1'
const clone = <T,>(value: T): T => structuredClone(value)
const id = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
const reviewStatusLabel = (status: WarningStatus) => status === 'accepted' ? '已接受' : status === 'ignored' ? '已忽略' : '待审'

const revisionOrder: RevisionColor[] = ['white', 'blue', 'pink', 'yellow', 'green', 'goldenrod', 'buff', 'salmon', 'cherry']
export const revisionLabels: Record<RevisionColor, string> = {
  white: '白纸', blue: '蓝', pink: '粉', yellow: '黄', green: '绿', goldenrod: '金菊', buff: '浅黄', salmon: '鲑粉', cherry: '樱桃'
}

function pendingRound(): ReviewRound {
  return { revision: 'white', signature: '', status: 'pending', decidedAt: '', replies: [] }
}

/** 旧本地数据缺少轮次标记时，按白纸版补齐，角色、场景和回复都保留。 */
function migrateRound(value: unknown): ReviewRound {
  if (!value || typeof value !== 'object') return pendingRound()
  const source = value as Record<string, unknown>
  const legacyReview = ('status' in source || 'replies' in source) ? source : (source.current as Record<string, unknown> | undefined)
  const fallback: ReviewRound = pendingRound()
  if (!legacyReview) return fallback
  const revision = revisionOrder.includes(legacyReview.revision as RevisionColor) ? legacyReview.revision as RevisionColor : 'white'
  const replies = Array.isArray(legacyReview.replies)
    ? (legacyReview.replies as Reply[]).filter((reply) => reply && reply.id && reply.text != null)
    : []
  const status: WarningStatus = legacyReview.status === 'accepted' || legacyReview.status === 'ignored' ? legacyReview.status : 'pending'
  return {
    revision,
    signature: typeof legacyReview.signature === 'string' ? legacyReview.signature : '',
    status,
    decidedAt: typeof legacyReview.decidedAt === 'string' ? legacyReview.decidedAt : (replies[0]?.createdAt ?? ''),
    backfilled: !('revision' in legacyReview),
    replies
  }
}

function migrateReview(value: unknown): WarningReview {
  const current = migrateRound(value)
  const history = value && typeof value === 'object' && Array.isArray((value as Record<string, unknown>).history)
    ? ((value as Record<string, unknown>).history as unknown[]).map(migrateRound)
    : []
  return { history, current }
}

function migrateScript(raw: unknown): Script | null {
  if (!raw || typeof raw !== 'object') return null
  const source = raw as Partial<Script>
  if (!Array.isArray(source.scenes) || !source.scenes.length) return null
  return {
    title: String(source.title ?? ''),
    writer: String(source.writer ?? ''),
    draft: String(source.draft ?? ''),
    scenes: source.scenes,
    characters: Array.isArray(source.characters) ? source.characters : [],
    props: Array.isArray(source.props) ? source.props : [],
    wardrobes: Array.isArray(source.wardrobes) ? source.wardrobes : []
  }
}

/** @internal 导出以供逻辑测试 */
export function migrateState(raw: unknown): ContinuityState | null {
  if (!raw || typeof raw !== 'object') return null
  const source = raw as Partial<ContinuityState>
  const script = migrateScript(source.script)
  if (!script) return null
  const reviews: Record<string, WarningReview> = {}
  if (source.reviews && typeof source.reviews === 'object') {
    for (const [warningId, review] of Object.entries(source.reviews as Record<string, unknown>)) {
      const migrated = migrateReview(review)
      // 没有任何结论与回复的空壳不保留。
      if (migrated.current.status !== 'pending' || migrated.current.replies.length || migrated.history.length) reviews[warningId] = migrated
    }
  }
  const versions: Version[] = Array.isArray(source.versions)
    ? source.versions.flatMap((version) => {
        if (!version || typeof version !== 'object') return []
        const item = version as Partial<Version>
        const versionScript = migrateScript(item.script)
        if (!item.id || !versionScript) return []
        const frozen: Record<string, WarningReview> = {}
        if (item.reviews && typeof item.reviews === 'object') {
          for (const [warningId, review] of Object.entries(item.reviews as Record<string, unknown>)) frozen[warningId] = migrateReview(review)
        }
        return [{
          id: String(item.id),
          name: String(item.name ?? '未命名版本'),
          createdAt: typeof item.createdAt === 'string' ? item.createdAt : new Date().toISOString(),
          script: versionScript,
          reviews: frozen
        }]
      })
    : []
  return { script, reviews, versions, updatedAt: typeof source.updatedAt === 'string' ? source.updatedAt : new Date().toISOString() }
}

function initialState(): ContinuityState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const migrated = migrateState(JSON.parse(raw))
      if (migrated) return migrated
    }
  } catch {
    // Ignore an invalid local draft and restore the bundled example.
  }
  return { script: clone(sampleScript), reviews: {}, versions: [], updatedAt: new Date().toISOString() }
}

export function deriveWarnings(script: Script): WarningItem[] {
  const warnings: WarningItem[] = []
  const sceneIndex = (sceneId: string) => script.scenes.findIndex((scene) => scene.id === sceneId)
  const charactersSeen = new Set<string>()
  const propsSeen = new Set<string>()

  // 指纹覆盖该警告依赖的剧本内容，任一字段（含修订色）变化都会让旧结论失效。
  const sceneStamp = (scene: Scene, extra: Record<string, unknown>) => JSON.stringify({
    s: {
      number: scene.number, slug: scene.slug, synopsis: scene.synopsis, intExt: scene.intExt, location: scene.location,
      dayNight: scene.dayNight, storyTime: scene.storyTime, pageLength: scene.pageLength,
      characterIds: scene.characterIds, propIds: scene.propIds, costumes: scene.costumes,
      revision: scene.revision, status: scene.status, reason: scene.reason
    },
    extra
  })

  script.scenes.forEach((scene, index) => {
    scene.characterIds.forEach((characterId) => {
      const character = script.characters.find((item) => item.id === characterId)
      if (!character) return
      const introducedAt = sceneIndex(character.introducedSceneId)
      if (index > 0 && !charactersSeen.has(characterId) && introducedAt >= index) {
        warnings.push({
          id: `character-${scene.id}-${characterId}`,
          type: 'character',
          severity: index > 1 ? 'error' : 'warning',
          sceneId: scene.id,
          title: `${character.name}突然出现`,
          detail: `角色在场景 ${scene.number} 首次出现，但前序场景没有建立其身份、关系或到场铺垫。`,
          suggestion: `在更早场景补充提及、声音或到场动作，并把“首次建立”场景改为相应场次。`,
          signature: sceneStamp(scene, { i: index, c: { n: character.name, intro: character.introducedSceneId, at: introducedAt } })
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
          type: 'prop',
          severity: 'error',
          sceneId: scene.id,
          title: `${prop.name}尚未提前建立`,
          detail: `道具在场景 ${scene.number} 已出现，但首次建立被标记在场景 ${script.scenes[introducedAt]?.number ?? '未知'}。`,
          suggestion: '调整首次建立场景，或在当前场景加入来源、交接动作与持有人反应。',
          signature: sceneStamp(scene, { i: index, p: { n: prop.name, intro: prop.introducedSceneId, at: introducedAt } })
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
          type: 'wardrobe',
          severity: 'warning',
          sceneId: scene.id,
          title: `${character.name}服装与时间冲突`,
          detail: `“${wardrobe.name}”只配置用于 ${wardrobe.timePeriods.join('、')}，本场标记为“${scene.dayNight}”。`,
          suggestion: '确认是否跨越时间连续拍摄；如需延续服装，请把当前时段加入服装适用范围。',
          signature: sceneStamp(scene, { w: { n: wardrobe.name, periods: wardrobe.timePeriods } })
        })
      }
    })

    if (index > 0 && script.scenes[index - 1].storyTime && scene.storyTime && index > 0) {
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
          suggestion: '调整故事时间，或明确使用倒叙并在场次摘要中标注时间跳转。',
          signature: sceneStamp(scene, { i: index, prev: { id: previous.id, num: previous.number, time: previous.storyTime, rev: previous.revision } })
        })
      }
    }
  })
  return warnings
}

export function diffScript(
  base: Script,
  current: Script,
  baseReviews: Record<string, WarningReview> = {},
  currentReviews: Record<string, WarningReview> = {},
  baseWarnings: WarningItem[] = deriveWarnings(base),
  currentWarnings: WarningItem[] = deriveWarnings(current)
): DiffItem[] {
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
      result.push({ id: `new-${scene.id}`, kind: 'scene', sceneNumber: scene.number, field: '场次', before: '不存在', after: `${scene.intExt}. ${scene.location} — ${scene.dayNight}` })
      return
    }
    fields.forEach(({ key, label }) => {
      const before = String(previous[key] ?? '')
      const after = String(scene[key] ?? '')
      if (before !== after) result.push({ id: `${scene.id}-${String(key)}`, kind: 'scene', sceneNumber: scene.number, field: label, before, after })
    })
  })
  base.scenes.forEach((scene) => {
    if (!current.scenes.some((item) => item.id === scene.id || sceneKey(item) === sceneKey(scene))) {
      result.push({ id: `deleted-${scene.id}`, kind: 'scene', sceneNumber: scene.number, field: '场次', before: `${scene.intExt}. ${scene.location} — ${scene.dayNight}`, after: '已删除' })
    }
  })

  // 审阅结论差异：结论版本（修订色）或判断本身不同即列出。
  const reviewIndex = new Map<string, { warning: WarningItem; side: 'base' | 'current' }>()
  baseWarnings.forEach((warning) => reviewIndex.set(warning.id, { warning, side: 'base' }))
  currentWarnings.forEach((warning) => reviewIndex.set(warning.id, { warning, side: 'current' }))
  const sceneNumber = (sceneId: string) => current.scenes.find((scene) => scene.id === sceneId)?.number
    ?? base.scenes.find((scene) => scene.id === sceneId)?.number ?? '-'
  reviewIndex.forEach(({ warning }, warningId) => {
    const before = baseReviews[warningId]?.current
    const after = currentReviews[warningId]?.current
    if (!before && !after) return
    const changed = !before || !after || before.status !== after.status || before.revision !== after.revision
    if (!changed) return
    result.push({
      id: `review-${warningId}`,
      kind: 'review',
      sceneNumber: sceneNumber(warning.sceneId),
      field: `审阅结论 · ${warning.title}`,
      before: before ? `${revisionLabels[before.revision]}版 · ${reviewStatusLabel(before.status)}` : '无审阅',
      after: after ? `${revisionLabels[after.revision]}版 · ${reviewStatusLabel(after.status)}` : '无审阅',
      review: { warningTitle: warning.title, beforeRevision: before?.revision ?? null, afterRevision: after?.revision ?? null }
    })
  })
  return result
}

interface Snapshot {
  script: Script
  reviews: Record<string, WarningReview>
}

/**
 * 按当前剧本重算警告并协调审阅轮次：
 * 内容指纹或修订色变化后，旧结论轮次归档（回复留作上一版说明），新轮次回到待审。
 */
/** @internal 导出以供逻辑测试 */
export function reconcileReviews(script: Script, reviews: Record<string, WarningReview>): Record<string, WarningReview> {
  const warnings = deriveWarnings(script)
  const next: Record<string, WarningReview> = { ...reviews }
  warnings.forEach((warning) => {
    const revision = script.scenes.find((scene) => scene.id === warning.sceneId)?.revision ?? 'white'
    const existing = next[warning.id]
    if (!existing) {
      next[warning.id] = { history: [], current: { revision, signature: warning.signature, status: 'pending', decidedAt: '', replies: [] } }
      return
    }
    const current = existing.current
    // 旧本地数据首次对齐：按白纸版补齐后，假定结论对当前内容仍有效，仅补上指纹。
    if (current.backfilled && !current.signature) {
      delete current.backfilled
      current.signature = warning.signature
      return
    }
    if (current.signature !== warning.signature) {
      next[warning.id] = {
        history: [...existing.history, clone(current)],
        current: { revision, signature: warning.signature, status: 'pending', decidedAt: '', replies: [] }
      }
    }
  })
  return next
}

export function useContinuityStore() {
  const [state, setState] = useState<ContinuityState>(() => {
    const initial = initialState()
    return { ...initial, reviews: reconcileReviews(initial.script, initial.reviews) }
  })
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving'>('saved')
  const undoRef = useRef<Snapshot[]>([])
  const redoRef = useRef<Snapshot[]>([])
  const saveTimer = useRef<number | undefined>(undefined)

  useEffect(() => {
    setSaveStatus('saving')
    window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
      setSaveStatus('saved')
    }, 160)
    return () => window.clearTimeout(saveTimer.current)
  }, [state])

  const mutate = useCallback((mutator: (script: Script) => void) => {
    setState((previous) => {
      const next = clone(previous.script)
      mutator(next)
      undoRef.current.push({ script: clone(previous.script), reviews: clone(previous.reviews) })
      if (undoRef.current.length > 80) undoRef.current.shift()
      redoRef.current = []
      return { ...previous, script: next, reviews: reconcileReviews(next, previous.reviews), updatedAt: new Date().toISOString() }
    })
  }, [])

  const applySnapshot = useCallback((snapshot: Snapshot, previous: ContinuityState, stack: 'undo' | 'redo') => {
    const restored = clone(snapshot)
    if (stack === 'undo') redoRef.current.push({ script: clone(previous.script), reviews: clone(previous.reviews) })
    else undoRef.current.push({ script: clone(previous.script), reviews: clone(previous.reviews) })
    return {
      ...previous,
      script: restored.script,
      reviews: reconcileReviews(restored.script, restored.reviews),
      updatedAt: new Date().toISOString()
    }
  }, [])

  const restoreSnapshot = useCallback((snapshot: Snapshot, previous: ContinuityState) => {
    const restored = clone(snapshot)
    return {
      ...previous,
      script: restored.script,
      reviews: reconcileReviews(restored.script, restored.reviews),
      updatedAt: new Date().toISOString()
    }
  }, [])

  const undo = useCallback(() => {
    setState((previous) => {
      const target = undoRef.current.pop()
      return target ? applySnapshot(target, previous, 'undo') : previous
    })
  }, [applySnapshot])

  const redo = useCallback(() => {
    setState((previous) => {
      const target = redoRef.current.pop()
      return target ? applySnapshot(target, previous, 'redo') : previous
    })
  }, [applySnapshot])

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
    setState((previous) => {
      const warnings = deriveWarnings(previous.script)
      const warning = warnings.find((item) => item.id === warningId)
      if (!warning) return previous
      const revision = previous.script.scenes.find((scene) => scene.id === warning.sceneId)?.revision ?? 'white'
      const previousReview = previous.reviews[warningId] ?? { history: [], current: pendingRound() }
      const current = clone(previousReview.current)
      const history = [...previousReview.history]
      // 在同一修订色、同一内容上改判，沿用本轮回复；跨色或跨内容则归档旧轮次。
      if (current.status !== 'pending' && (current.revision !== revision || current.signature !== warning.signature)) {
        history.push(current)
        current.replies = []
      }
      current.revision = revision
      current.signature = warning.signature
      current.status = status
      current.decidedAt = new Date().toISOString()
      delete current.backfilled
      return {
        ...previous,
        reviews: { ...previous.reviews, [warningId]: { history, current } },
        updatedAt: current.decidedAt
      }
    })
  }, [])

  const addReply = useCallback((warningId: string, author: string, text: string) => {
    if (!text.trim()) return
    const reply: Reply = { id: id('reply'), author: author.trim() || '作者', text: text.trim(), createdAt: new Date().toISOString() }
    setState((previous) => {
      const review = previous.reviews[warningId]
      if (!review) return previous
      return {
        ...previous,
        reviews: {
          ...previous.reviews,
          [warningId]: { ...review, current: { ...review.current, replies: [...review.current.replies, reply] } }
        },
        updatedAt: reply.createdAt
      }
    })
  }, [])

  const createVersion = useCallback((name: string) => {
    const version: Version = {
      id: id('version'),
      name: name.trim() || `版本 ${state.versions.length + 1}`,
      createdAt: new Date().toISOString(),
      script: clone(state.script),
      // 保存版本时冻结审阅状态：结论、回复与修订色一并封存。
      reviews: clone(state.reviews)
    }
    setState((previous) => ({ ...previous, versions: [version, ...previous.versions] }))
    return version
  }, [state.script, state.reviews, state.versions.length])

  const restoreVersion = useCallback((versionId: string) => {
    setState((previous) => {
      const version = previous.versions.find((item) => item.id === versionId)
      if (!version) return previous
      undoRef.current.push({ script: clone(previous.script), reviews: clone(previous.reviews) })
      if (undoRef.current.length > 80) undoRef.current.shift()
      redoRef.current = []
      const snapshot: Snapshot = { script: clone(version.script), reviews: clone(version.reviews) }
      // 恢复后按冻结状态显示当时的判断；仅在内容指纹对不上时才让结论回到待审。
      return restoreSnapshot(snapshot, previous)
    })
  }, [restoreSnapshot])

  const reset = useCallback(() => {
    setState((previous) => {
      undoRef.current.push({ script: clone(previous.script), reviews: clone(previous.reviews) })
      redoRef.current = []
      return restoreSnapshot({ script: clone(sampleScript), reviews: {} }, previous)
    })
  }, [restoreSnapshot])

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
