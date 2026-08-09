/**
 * ui-dropdown.ts — 自定义下拉组件（深色主题）
 * 职责：替代原生 select，统一视觉与键盘交互
 */

export interface DropdownOption {
  value: string
  label: string
}

export interface DropdownOpts {
  options: DropdownOption[]
  value?: string
  onChange: (value: string) => void
  placeholder?: string
}

export interface DropdownApi {
  el: HTMLElement
  getValue(): string
  setValue(v: string): void
  dispose(): void
}

export function createDropdown(opts: DropdownOpts): DropdownApi {
  const wrapper = document.createElement('div')
  wrapper.className = 'dropdown'

  const trigger = document.createElement('button')
  trigger.type = 'button'
  trigger.className = 'dropdown-trigger'

  const list = document.createElement('ul')
  list.className = 'dropdown-list'
  list.role = 'listbox'

  let currentValue = opts.value ?? ''
  let open = false
  let activeIndex = -1
  let items: HTMLLIElement[] = []
  let lastCloseTime = 0

  function findIndexByValue(v: string): number {
    return opts.options.findIndex((o) => o.value === v)
  }

  function updateTrigger(): void {
    const found = opts.options.find((o) => o.value === currentValue)
    const label = found ? found.label : (opts.placeholder ?? '请选择')
    // 文本放可收缩 span 内，flex 容器中 ellipsis 才生效
    let span = trigger.querySelector('.dropdown-trigger-text') as HTMLSpanElement | null
    if (!span) {
      span = document.createElement('span')
      span.className = 'dropdown-trigger-text'
      trigger.appendChild(span)
    }
    span.textContent = label
    trigger.title = label // 长文本省略号截断时 hover 显示全名
  }

  function buildList(): void {
    list.innerHTML = ''
    items = opts.options.map((o, i) => {
      const li = document.createElement('li')
      li.className = 'dropdown-item'
      li.role = 'option'
      li.dataset.value = o.value
      li.textContent = o.label
      li.title = o.label
      li.tabIndex = -1
      li.addEventListener('click', (e) => {
        e.stopPropagation()
        selectOption(i)
      })
      li.addEventListener('mouseenter', () => {
        activeIndex = i
        highlightItem()
      })
      return li
    })
    for (const li of items) list.appendChild(li)
  }

  function highlightItem(): void {
    for (let i = 0; i < items.length; i++) {
      items[i].classList.toggle('active', i === activeIndex)
      items[i].setAttribute('aria-selected', String(i === activeIndex))
    }
  }

  function selectOption(index: number): void {
    const opt = opts.options[index]
    if (!opt) return
    currentValue = opt.value
    updateTrigger()
    closeList()
    opts.onChange(currentValue)
  }

  function openList(): void {
    if (open || opts.options.length === 0) return
    open = true
    wrapper.classList.add('open')
    list.classList.add('open')
    activeIndex = findIndexByValue(currentValue)
    if (activeIndex < 0) activeIndex = 0
    highlightItem()
    // 定位到视口内
    const rect = trigger.getBoundingClientRect()
    const listHeight = Math.min(240, list.scrollHeight)
    const spaceBelow = window.innerHeight - rect.bottom - 8
    const spaceAbove = rect.top - 8
    if (spaceBelow < listHeight && spaceAbove > spaceBelow) {
      list.style.maxHeight = `${Math.min(listHeight, spaceAbove)}px`
      list.style.bottom = `${trigger.offsetHeight + 4}px`
      list.style.top = 'auto'
    } else {
      list.style.maxHeight = `${Math.min(listHeight, spaceBelow)}px`
      list.style.top = `${trigger.offsetHeight + 4}px`
      list.style.bottom = 'auto'
    }
    if (items[activeIndex]) {
      items[activeIndex].scrollIntoView({ block: 'nearest' })
    }
  }

  function closeList(): void {
    if (!open) return
    open = false
    lastCloseTime = Date.now()
    wrapper.classList.remove('open')
    list.classList.remove('open')
    activeIndex = -1
    highlightItem()
  }

  function toggleList(): void {
    // 选择后对话框可能因高度变化整体位移，触发按钮"滑到"鼠标下产生二次
    // click 重开列表 —— 关闭后 150ms 内忽略重开
    if (!open && Date.now() - lastCloseTime < 150) return
    if (open) closeList()
    else openList()
  }

  function onKeyDown(e: KeyboardEvent): void {
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        openList()
      }
      return
    }
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        activeIndex = (activeIndex + 1) % items.length
        highlightItem()
        items[activeIndex]?.scrollIntoView({ block: 'nearest' })
        break
      case 'ArrowUp':
        e.preventDefault()
        activeIndex = activeIndex <= 0 ? items.length - 1 : activeIndex - 1
        highlightItem()
        items[activeIndex]?.scrollIntoView({ block: 'nearest' })
        break
      case 'Enter':
        e.preventDefault()
        if (activeIndex >= 0) selectOption(activeIndex)
        break
      case 'Escape':
        e.preventDefault()
        closeList()
        trigger.focus()
        break
      case 'Tab':
        closeList()
        break
    }
  }

  function onDocClick(e: MouseEvent): void {
    if (!wrapper.contains(e.target as Node)) {
      closeList()
    }
  }

  trigger.addEventListener('click', (e) => {
    e.stopPropagation()
    toggleList()
  })
  trigger.addEventListener('keydown', onKeyDown)
  document.addEventListener('click', onDocClick)

  wrapper.appendChild(trigger)
  wrapper.appendChild(list)
  updateTrigger()
  buildList()

  return {
    el: wrapper,
    getValue() {
      return currentValue
    },
    setValue(v: string) {
      currentValue = v
      updateTrigger()
    },
    dispose() {
      document.removeEventListener('click', onDocClick)
      closeList()
      wrapper.remove()
    },
  }
}
