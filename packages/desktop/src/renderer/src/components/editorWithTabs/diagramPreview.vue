<template>
  <aside
    class="diagram-side-preview"
    :aria-label="t('editor.diagramPreview.title')"
    dir="ltr"
    @keydown.stop
  >
    <header>
      <span>{{ t('editor.diagramPreview.title') }}</span>
      <button
        type="button"
        :aria-label="t('editor.mediaViewer.close')"
        @click="emit('close')"
      >
        <Close />
      </button>
    </header>
    <div
      class="diagram-preview-toolbar"
      @mousedown.prevent
    >
      <button
        type="button"
        :aria-label="t('editor.mediaViewer.zoomOut')"
        @click="zoom(1 / 1.25)"
      >
        <ZoomOut />
      </button>
      <button
        type="button"
        class="zoom-level"
        :aria-label="t('editor.mediaViewer.actualSize')"
        @click="actualSize"
      >
        {{ Math.round(scale * 100) }}%
      </button>
      <button
        type="button"
        :aria-label="t('editor.mediaViewer.zoomIn')"
        @click="zoom(1.25)"
      >
        <ZoomIn />
      </button>
      <button
        type="button"
        :aria-label="t('editor.mediaViewer.fit')"
        @click="fit"
      >
        <FullScreen />
      </button>
    </div>
    <div
      ref="stageRef"
      class="diagram-preview-stage"
      tabindex="0"
      :aria-label="t('editor.diagramPreview.canvas')"
      @keydown="onKeydown"
    >
      <figure
        ref="contentRef"
        class="mu-diagram-block"
      />
    </div>
  </aside>
</template>

<script setup lang="ts">
import { ref, watch, onMounted, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import { Close, ZoomOut, ZoomIn, FullScreen } from '@element-plus/icons-vue'
import { ZoomPanController } from '@/util/zoomPan'
import { naturalSvgSize } from '@/util/diagramExport'

const props = defineProps<{ source: HTMLElement }>()
const emit = defineEmits<{ (event: 'close'): void }>()
const { t } = useI18n()
const stageRef = ref<HTMLElement | null>(null)
const contentRef = ref<HTMLElement | null>(null)
const scale = ref(1)
let controller: ZoomPanController | null = null
let observer: MutationObserver | null = null
let resizeObserver: ResizeObserver | null = null
let sourceBlock: Element | null = null
let timer = 0
let autoFit = true
let cloneCount = 0

const fit = () => {
  autoFit = true
  controller?.fit()
}
const zoom = (factor: number) => {
  autoFit = false
  controller?.zoomBy(factor)
}
const actualSize = () => {
  autoFit = false
  controller?.actualSize()
}

const refresh = () => {
  const content = contentRef.value
  if (!content) return
  const preview = props.source.cloneNode(true) as HTMLElement
  const svg = preview.querySelector('svg')
  if (svg) {
    const size = naturalSvgSize(svg)
    svg.setAttribute('width', String(size.width))
    svg.setAttribute('height', String(size.height))
    svg.style.maxWidth = 'none'
    svg.style.width = `${size.width}px`
    svg.style.height = `${size.height}px`
  }
  // SVG markers and labels resolve IDs document-wide, including the editor's original.
  const prefix = `diagram-side-${++cloneCount}-`
  const ids = new Map<string, string>()
  for (const element of preview.querySelectorAll('[id]')) {
    ids.set(element.id, prefix + element.id)
    element.id = prefix + element.id
  }
  for (const style of preview.querySelectorAll('style')) {
    for (const [id, renamed] of [...ids].sort((a, b) => b[0].length - a[0].length)) {
      style.textContent = (style.textContent ?? '').replaceAll(`#${id}`, `#${renamed}`)
    }
  }
  for (const element of preview.querySelectorAll('*')) {
    for (const attribute of [...element.attributes]) {
      let value = attribute.value.replace(/url\(["']?#([^\s)"']+)["']?\)/g, (match, id: string) =>
        ids.has(id) ? `url(#${ids.get(id)})` : match
      )
      if ((attribute.name === 'href' || attribute.name === 'xlink:href') && ids.has(value.slice(1)))
        value = `#${ids.get(value.slice(1))}`
      if (attribute.name === 'aria-labelledby' || attribute.name === 'aria-describedby')
        value = value
          .split(' ')
          .map((id) => ids.get(id) ?? id)
          .join(' ')
      if (value !== attribute.value) element.setAttribute(attribute.name, value)
    }
  }
  preview.querySelector('img')?.addEventListener(
    'load',
    () => {
      if (autoFit) controller?.fit()
    },
    { once: true }
  )
  content.replaceChildren(preview)
  if (autoFit) controller?.fit()
}

const disconnect = () => {
  window.clearTimeout(timer)
  observer?.disconnect()
  sourceBlock?.classList.remove('diagram-preview-source')
}

const observe = () => {
  disconnect()
  autoFit = true
  sourceBlock = props.source.closest('.mu-diagram-block')
  sourceBlock?.classList.add('diagram-preview-source')
  observer = new MutationObserver(() => {
    window.clearTimeout(timer)
    timer = window.setTimeout(refresh, 60)
  })
  observer.observe(props.source, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true
  })
  refresh()
}

const onKeydown = (event: KeyboardEvent) => {
  switch (event.key) {
    case '+':
    case '=':
      zoom(1.25)
      break
    case '-':
      zoom(1 / 1.25)
      break
    case '0':
      fit()
      break
    case '1':
      actualSize()
      break
    case 'ArrowLeft':
      controller?.panBy(40, 0)
      break
    case 'ArrowRight':
      controller?.panBy(-40, 0)
      break
    case 'ArrowUp':
      controller?.panBy(0, 40)
      break
    case 'ArrowDown':
      controller?.panBy(0, -40)
      break
    default:
      return
  }
  event.preventDefault()
  event.stopPropagation()
}

watch(() => props.source, observe)
onMounted(() => {
  if (!stageRef.value || !contentRef.value) return
  stageRef.value.addEventListener(
    'wheel',
    () => {
      autoFit = false
    },
    { passive: true }
  )
  controller = new ZoomPanController(stageRef.value, contentRef.value, {
    onChange: (state) => {
      scale.value = state.scale
    }
  })
  resizeObserver = new ResizeObserver(() => {
    if (autoFit) controller?.fit()
  })
  resizeObserver.observe(stageRef.value)
  observe()
})
onBeforeUnmount(() => {
  disconnect()
  resizeObserver?.disconnect()
  controller?.destroy()
})
</script>

<style scoped>
.diagram-side-preview {
  flex: 0 0 42%;
  min-width: 260px;
  max-width: 65%;
  height: 100%;
  display: flex;
  flex-direction: column;
  border-left: 1px solid var(--editorColor10);
  background: var(--editorBgColor);
  overflow: hidden;
  color: var(--editorColor);
}
header,
.diagram-preview-toolbar {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 8px 12px;
  flex-shrink: 0;
}
header {
  justify-content: space-between;
  font-size: 13px;
}
button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 30px;
  min-width: 30px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: inherit;
  cursor: pointer;
}
button:hover {
  background: var(--editorColor10);
}
button:focus-visible,
.diagram-preview-stage:focus-visible {
  outline: 2px solid var(--themeColor);
  outline-offset: -2px;
}
button svg {
  width: 16px;
  height: 16px;
}
.zoom-level {
  min-width: 54px;
  font-variant-numeric: tabular-nums;
}
.diagram-preview-stage {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: grab;
}
.diagram-preview-stage > figure {
  flex: none;
  margin: 0;
  padding: 16px;
}
</style>
