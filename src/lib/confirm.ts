/**
 * confirm.ts — 自定义确认弹窗（D2 决策）
 * 替代 window.confirm：复用项目 dialog 风格、深色主题、Promise API。
 *
 * 行为约定：
 * - 复用 base.css 中 dialog 的视觉风格
 * - 焦点落在「取消」按钮上（防误操作）
 * - 按 Esc 视为取消；点击遮罩关闭视为取消
 * - 调用方可指定 okLabel / cancelLabel（默认「确定」「取消」）
 * - okButtonClass 默认 'primary'，confirm 为破坏性操作时可传 'danger'
 *
 * 文本安全：消息用 textContent 渲染（textContent 安全渲染约束）
 */

export interface ConfirmOpts {
  message: string
  okLabel?: string
  cancelLabel?: string
  okButtonClass?: 'primary' | 'danger'
}

export function confirmDialog(opts: ConfirmOpts): Promise<boolean> {
  return new Promise((resolve) => {
    const dlg = document.createElement('dialog')
    dlg.className = 'confirm-dialog'

    const msg = document.createElement('p')
    msg.className = 'confirm-message'
    msg.textContent = opts.message

    const actions = document.createElement('div')
    actions.className = 'dialog-actions'

    const cancelBtn = document.createElement('button')
    cancelBtn.type = 'button'
    cancelBtn.textContent = opts.cancelLabel ?? '取消'

    const okBtn = document.createElement('button')
    okBtn.type = 'button'
    okBtn.className = opts.okButtonClass ?? 'primary'
    okBtn.textContent = opts.okLabel ?? '确定'

    actions.appendChild(cancelBtn)
    actions.appendChild(okBtn)
    dlg.appendChild(msg)
    dlg.appendChild(actions)
    document.body.appendChild(dlg)

    let resolved = false
    function finish(answer: boolean): void {
      if (resolved) return
      resolved = true
      dlg.close()
      dlg.remove()
      // 兜底：万一有残留监听（极端情况下 close 事件未触发的浏览器），直接 resolve
      resolve(answer)
    }

    cancelBtn.addEventListener('click', () => finish(false))
    okBtn.addEventListener('click', () => finish(true))
    // Esc / 点击遮罩 → 取消（cancel 事件天然触发 close，close 兜底）
    dlg.addEventListener('close', () => {
      if (!resolved) finish(false)
    })

    dlg.showModal()
    // 焦点落在取消按钮（防误操作）
    requestAnimationFrame(() => cancelBtn.focus())
  })
}
