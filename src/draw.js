const browser = require("./browser")

const {childContainer} = require("./dompos")

const DIRTY_RESCAN = 1, DIRTY_REDRAW = 2
exports.DIRTY_RESCAN = DIRTY_RESCAN; exports.DIRTY_REDRAW = DIRTY_REDRAW

// FIXME track dirty ranges in a better way

function options() {
  return {
    pos: 0,

    onRender(node, dom, _pos, offset) {
      if (node.isBlock) {
        if (offset != null)
          dom.setAttribute("pm-offset", offset)
        dom.setAttribute("pm-size", node.nodeSize)
        if (node.isTextblock)
          adjustTrailingHacks(dom, node)
        if (dom.contentEditable == "false") {
          let wrap = document.createElement("div")
          wrap.appendChild(dom)
          dom = wrap
        }
      }

      return dom
    },
    onContainer(dom) {
      dom.setAttribute("pm-container", true)
    },
    // : (Node, dom.Node, number, number) → dom.Node
    renderInlineFlat(node, dom, _pos, offset) {
      let inner = dom
      for (let i = 0; i < node.marks.length; i++) inner = inner.firstChild

      if (dom.nodeType != 1) {
        let wrap = document.createElement("span")
        wrap.appendChild(dom)
        dom = wrap
      }

      dom.setAttribute("pm-offset", offset)
      dom.setAttribute("pm-size", node.nodeSize)

      return dom
    },
    document
  }
}

function draw(view, doc) {
  view.content.textContent = ""
  view.content.appendChild(doc.content.toDOM(options()))
}
exports.draw = draw

function adjustTrailingHacks(dom, node) {
  let needs = node.content.size == 0 || node.lastChild.type.isBR ||
      (node.type.isCode && node.lastChild.isText && /\n$/.test(node.lastChild.text))
      ? "br" : !node.lastChild.isText && node.lastChild.isLeaf ? "text" : null
  let last = dom.lastChild
  let has = !last || last.nodeType != 1 || !last.hasAttribute("pm-ignore") ? null
      : last.nodeName == "BR" ? "br" : "text"
  if (needs != has) {
    if (has) dom.removeChild(last)
    if (needs) {
      let add = document.createElement(needs == "br" ? "br" : "span")
      add.setAttribute("pm-ignore", needs == "br" ? "trailing-break" : "cursor-text")
      dom.appendChild(add)
    }
  }
}

function findNodeIn(parent, i, node) {
  for (; i < parent.childCount; i++) {
    let child = parent.child(i)
    if (child == node) return i
  }
  return -1
}

function movePast(dom) {
  let next = dom.nextSibling
  dom.parentNode.removeChild(dom)
  return next
}

function redraw(view, oldState, newState) {
  let dirty = view.dirtyNodes
  if (dirty.get(oldState.doc) == DIRTY_REDRAW) return draw(view, newState.doc)

  let opts = options()

  function scan(dom, node, prev, pos) {
    let iPrev = 0, oPrev = 0, pChild = prev.firstChild
    let domPos = dom.firstChild

    function syncDOM() {
      while (domPos) {
        let curOff = domPos.nodeType == 1 && domPos.getAttribute("pm-offset")
        if (!curOff || +curOff < oPrev)
          domPos = movePast(domPos)
        else
          return +curOff == oPrev
      }
      return false
    }

    for (let iNode = 0, offset = 0; iNode < node.childCount; iNode++) {
      let child = node.child(iNode), matching, reuseDOM
      let found = pChild == child ? iPrev : findNodeIn(prev, iPrev + 1, child)
      if (found > -1) {
        matching = child
        while (iPrev != found) {
          oPrev += pChild.nodeSize
          pChild = prev.maybeChild(++iPrev)
        }
      }

      if (matching && !dirty.get(matching) && syncDOM()) {
        reuseDOM = true
      } else if (pChild && !child.isText && child.sameMarkup(pChild) && dirty.get(pChild) != DIRTY_REDRAW && syncDOM()) {
        reuseDOM = true
        if (!pChild.isLeaf)
          scan(childContainer(domPos), child, pChild, pos + offset + 1)
        domPos.setAttribute("pm-size", child.nodeSize)
      } else {
        opts.pos = pos + offset
        opts.offset = offset
        let rendered = child.toDOM(opts)
        dom.insertBefore(rendered, domPos)
        reuseDOM = false
      }

      if (reuseDOM) {
        // Text nodes might be split into smaller segments
        if (child.isText) {
          for (let off = offset, end = off + child.nodeSize; off < end;) {
            if (offset != oPrev)
              domPos.setAttribute("pm-offset", off)
            off += +domPos.getAttribute("pm-size")
            domPos = domPos.nextSibling
          }
        } else {
          if (offset != oPrev)
            domPos.setAttribute("pm-offset", offset)
          domPos = domPos.nextSibling
        }
        oPrev += pChild.nodeSize
        pChild = prev.maybeChild(++iPrev)
      }
      offset += child.nodeSize
    }

    while (domPos) domPos = movePast(domPos)

    if (node.isTextblock) adjustTrailingHacks(dom, node)

    if (browser.ios) iosHacks(dom)
  }
  scan(view.content, newState.doc, oldState.doc, 0)
}
exports.redraw = redraw

function iosHacks(dom) {
  if (dom.nodeName == "UL" || dom.nodeName == "OL") {
    let oldCSS = dom.style.cssText
    dom.style.cssText = oldCSS + "; list-style: square !important"
    window.getComputedStyle(dom).listStyle
    dom.style.cssText = oldCSS
  }
}