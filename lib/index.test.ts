import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import {
  elementTreeFromPoint,
  ElementTree,
  dispatchToUnderlyingElements,
  engineIndependentElementsFromPoint,
} from '.'
import { html, render } from 'lit-html'
import stripIndent from 'strip-indent'
import { LitElement, ReactiveElement, css } from 'lit'
import { customElement } from 'lit/decorators.js'

function getElementLabel(element: Element) {
  const { tagName, id } = element
  return `${tagName}${id ? '#' : ''}${id}`
}

function formatNode(tree: ElementTree, element: Element): string {
  const childNodes = tree.elementsByParent.get(element) ?? []
  const formattedChildNodes = childNodes
    .map((child) => formatNode(tree, child))
    .map((s) => {
      const [firstLine, ...otherLines] = s.split('\n')
      const bulletedFirstLine = `* ${firstLine}`
      const indentedOtherLines = otherLines.map((line) => `  ${line}`)
      return [bulletedFirstLine, ...indentedOtherLines].join('\n')
    })
  const extra = formattedChildNodes.join('\n')
  const joiner = extra ? '\n' : ''
  return `${getElementLabel(element)}${joiner}${extra}`
}

function formatElementTree(tree: ElementTree | null) {
  if (!tree) return null
  return formatNode(tree, tree.root)
}

function strip(formattedElementTree: string) {
  return stripIndent(formattedElementTree).trim()
}

function docById(id: string) {
  return document.getElementById(id)!
}
function docQuery(query: string) {
  return document.querySelector(query)!
}

@customElement('shadow-dom-element')
export class ShadowDomElement extends LitElement {
  static readonly styles = css`
    div {
      position: absolute;
      width: 1px;
      height: 1px;
      pointer-events: auto;
    }
  `

  render() {
    return html`<div id="inside-shadow-dom-element"></div>`
  }
}

@customElement('containing-shadow-dom-element')
export class ContainingShadowDomElement extends LitElement {
  static readonly styles = css`
    shadow-dom-element {
      position: absolute;
      width: 1px;
      height: 1px;
    }
  `

  render() {
    return html`<shadow-dom-element></shadow-dom-element>`
  }
}

function isReactiveElement(element: Element): element is ReactiveElement {
  return element instanceof ReactiveElement
}

async function allShadowDomElementsUpdated() {
  const elements = Array.from(document.querySelectorAll('*')).filter(
    isReactiveElement
  )
  return Promise.all(elements.map((e) => e.updateComplete))
}

describe('engineIndependentElementsFromPoint', () => {
  describe('shadow-dom-element', () => {
    const getShadowDomElement = () =>
      document.querySelector('shadow-dom-element')

    describe('pointer-events: auto', () => {
      beforeEach(async () => {
        render(
          html`
            <style>
              * {
                position: absolute;
                width: 1px;
                height: 1px;
              }
            </style>
            <shadow-dom-element> </shadow-dom-element>
          `,
          document.body
        )
        await allShadowDomElementsUpdated()
      })

      test('from document', async () => {
        expect(
          engineIndependentElementsFromPoint(0, 0).map(getElementLabel)
        ).toEqual(['SHADOW-DOM-ELEMENT', 'BODY', 'HTML'])
      })

      test('from shadow-dom-element', async () => {
        expect(
          engineIndependentElementsFromPoint(
            0,
            0,
            getShadowDomElement()!.shadowRoot!
          ).map(getElementLabel)
        ).toEqual([
          'DIV#inside-shadow-dom-element',
          'SHADOW-DOM-ELEMENT',
          'BODY',
          'HTML',
        ])
      })
    })

    describe('pointer-events: none', () => {
      beforeEach(async () => {
        render(
          html`
            <style>
              * {
                position: absolute;
                width: 1px;
                height: 1px;
              }
            </style>
            <shadow-dom-element style="pointer-events: none">
            </shadow-dom-element>
          `,
          document.body
        )
        await allShadowDomElementsUpdated()
      })

      test('from document', async () => {
        expect(
          engineIndependentElementsFromPoint(0, 0).map(getElementLabel)
        ).toEqual(['SHADOW-DOM-ELEMENT', 'BODY', 'HTML'])
      })

      test('from shadow-dom-element', async () => {
        expect(
          engineIndependentElementsFromPoint(
            0,
            0,
            getShadowDomElement()!.shadowRoot!
          ).map(getElementLabel)
        ).toEqual(['DIV#inside-shadow-dom-element', 'BODY', 'HTML'])
      })
    })
  })

  describe('containing-shadow-dom-element', () => {
    const getContainingShadowDomElement = () =>
      document.querySelector('containing-shadow-dom-element')
    const getInnerShadowDomElement = () =>
      getContainingShadowDomElement()?.shadowRoot!.querySelector(
        'shadow-dom-element'
      )

    beforeEach(async () => {
      render(
        html`
          <style>
            * {
              position: absolute;
              width: 1px;
              height: 1px;
            }
          </style>
          <containing-shadow-dom-element> </containing-shadow-dom-element>
        `,
        document.body
      )
      await allShadowDomElementsUpdated()
    })

    test('from document', async () => {
      expect(
        engineIndependentElementsFromPoint(0, 0).map(getElementLabel)
      ).toEqual(['CONTAINING-SHADOW-DOM-ELEMENT', 'BODY', 'HTML'])
    })

    test('from containing-shadow-dom-element', async () => {
      expect(
        engineIndependentElementsFromPoint(
          0,
          0,
          getContainingShadowDomElement()!.shadowRoot!
        ).map(getElementLabel)
      ).toEqual([
        'SHADOW-DOM-ELEMENT',
        'CONTAINING-SHADOW-DOM-ELEMENT',
        'BODY',
        'HTML',
      ])
    })

    test('from inner shadow-dom-element', async () => {
      expect(
        engineIndependentElementsFromPoint(
          0,
          0,
          getInnerShadowDomElement()!.shadowRoot!
        ).map(getElementLabel)
      ).toEqual([
        'DIV#inside-shadow-dom-element',
        'SHADOW-DOM-ELEMENT',
        'CONTAINING-SHADOW-DOM-ELEMENT',
        'BODY',
        'HTML',
      ])
    })
  })
})

describe('elementTreeFromPoint', () => {
  test('no elements under cursor', () => {
    expect(elementTreeFromPoint(-1, -1)!).toBe(null)
  })

  test('minimal tree', () => {
    render(html``, document.body)
    const tree = elementTreeFromPoint(0, 0)!
    expect(tree.root.tagName).toEqual('HTML')
    expect(formatElementTree(tree)).toEqual(
      strip(`
        HTML
        * BODY
      `)
    )
  })

  test('single div', () => {
    render(html`<div style="width: 1px; height: 1px"></div>`, document.body)
    const tree = elementTreeFromPoint(0, 0)!
    expect(formatElementTree(tree)).toEqual(
      strip(`
        HTML
        * BODY
          * DIV
      `)
    )
  })

  test('structure of absolutely-positioned divs', () => {
    render(
      html`
        <style>
          * {
            position: absolute;
            width: 1px;
            height: 1px;
          }
        </style>
        <div id="1">
          <div id="1.1"></div>
          <div id="1.2"></div>
        </div>
        <div id="2">
          <div id="2.1"></div>
          <div id="2.2"></div>
        </div>
      `,
      document.body
    )
    const tree = elementTreeFromPoint(0, 0)!
    expect(formatElementTree(tree)).toEqual(
      strip(`
        HTML
        * BODY
          * DIV#2
            * DIV#2.2
            * DIV#2.1
          * DIV#1
            * DIV#1.2
            * DIV#1.1
      `)
    )
  })

  test('pointer-events none on parent', () => {
    render(
      html`
        <style>
          * {
            width: 1px;
            height: 1px;
          }
        </style>
        <div id="1" style="pointer-events: none">
          <div id="1.1" style="pointer-events: auto"></div>
        </div>
      `,
      document.body
    )
    const tree = elementTreeFromPoint(0, 0)!
    expect(formatElementTree(tree)).toEqual(
      strip(`
        HTML
        * BODY
          * DIV#1.1
      `)
    )
  })

  test('pointer-events none on html and body', () => {
    render(
      html`
        <style>
          * {
            position: absolute;
            width: 1px;
            height: 1px;
            pointer-events: none;
          }
        </style>
        <div style="pointer-events: auto"></div>
      `,
      document.body
    )
    const tree = elementTreeFromPoint(0, 0)!
    expect(formatElementTree(tree)).toEqual(
      strip(`
        HTML
        * DIV
      `)
    )
  })

  test('shadow dom element', async () => {
    render(
      html`
        <style>
          * {
            position: absolute;
            width: 1px;
            height: 1px;
          }
        </style>
        <div id="before-shadow-dom-element"></div>
        <shadow-dom-element> </shadow-dom-element>
        <div id="after-shadow-dom-element"></div>
      `,
      document.body
    )
    await allShadowDomElementsUpdated()
    const tree = elementTreeFromPoint(0, 0)!
    expect(formatElementTree(tree)).toEqual(
      strip(`
        HTML
        * BODY
          * DIV#after-shadow-dom-element
          * SHADOW-DOM-ELEMENT
            * DIV#inside-shadow-dom-element
          * DIV#before-shadow-dom-element
      `)
    )
  })

  test('shadow dom element pointer-events none but inner element pointer-events auto', async () => {
    render(
      html`
        <style>
          * {
            position: absolute;
            width: 1px;
            height: 1px;
          }
        </style>
        <shadow-dom-element style="pointer-events: none"> </shadow-dom-element>
      `,
      document.body
    )
    await allShadowDomElementsUpdated()
    const tree = elementTreeFromPoint(0, 0)!
    expect(formatElementTree(tree)).toEqual(
      strip(`
        HTML
        * BODY
          * DIV#inside-shadow-dom-element
      `)
    )
  })

  test('containing shadow dom element', async () => {
    render(
      html`
        <style>
          * {
            position: absolute;
            width: 1px;
            height: 1px;
          }
        </style>
        <containing-shadow-dom-element> </containing-shadow-dom-element>
      `,
      document.body
    )
    await allShadowDomElementsUpdated()
    const tree = elementTreeFromPoint(0, 0)!
    expect(formatElementTree(tree)).toEqual(
      strip(`
        HTML
        * BODY
          * CONTAINING-SHADOW-DOM-ELEMENT
            * SHADOW-DOM-ELEMENT
              * DIV#inside-shadow-dom-element
      `)
    )
  })

  test('containing shadow dom element with query starting from most inner shadow root', async () => {
    render(
      html`
        <style>
          * {
            position: absolute;
            width: 1px;
            height: 1px;
          }
        </style>
        <containing-shadow-dom-element> </containing-shadow-dom-element>
      `,
      document.body
    )
    await allShadowDomElementsUpdated()
    const mostInnerShadowRoot = document
      .querySelector('containing-shadow-dom-element')!
      .shadowRoot!.querySelector('shadow-dom-element')!.shadowRoot!
    const tree = elementTreeFromPoint(0, 0, mostInnerShadowRoot)!
    expect(formatElementTree(tree)).toEqual(
      strip(`
        HTML
        * BODY
          * CONTAINING-SHADOW-DOM-ELEMENT
            * SHADOW-DOM-ELEMENT
              * DIV#inside-shadow-dom-element
      `)
    )
  })

  test('element after containing shadow dom element', async () => {
    render(
      html`
        <style>
          * {
            position: absolute;
            width: 1px;
            height: 1px;
          }
        </style>
        <containing-shadow-dom-element> </containing-shadow-dom-element>
        <div></div>
      `,
      document.body
    )
    await allShadowDomElementsUpdated()
    const tree = elementTreeFromPoint(0, 0)!
    expect(formatElementTree(tree)).toEqual(
      strip(`
        HTML
        * BODY
          * DIV
          * CONTAINING-SHADOW-DOM-ELEMENT
            * SHADOW-DOM-ELEMENT
              * DIV#inside-shadow-dom-element
      `)
    )
  })
})

describe('dispatchToUnderlyingElements', () => {
  const eventTargets: Element[] = []
  function logEventTarget(type: string, target: Element) {
    target.addEventListener(type, (event: Event) => {
      eventTargets.push(event.currentTarget as Element)
    })
  }
  function preventDefaultOnHandle(type: string, target: Element) {
    target.addEventListener(type, (event: Event) => {
      event.preventDefault()
    })
  }

  describe('structure including shadow dom element', () => {
    beforeEach(async () => {
      render(
        html`
          <style>
            * {
              position: absolute;
              width: 1px;
              height: 1px;
            }
          </style>
          <div id="container">
            <div id="lowest">
              <div id="inside-lowest"></div>
            </div>
            <shadow-dom-element> </shadow-dom-element>
            <div id="highest">
              <div id="inside-highest"></div>
            </div>
          </div>
        `,
        document.body
      )
      await allShadowDomElementsUpdated()
    })

    afterEach(() => {
      render(html``, document.body)
      eventTargets.splice(0, eventTargets.length)
    })

    test('correct event order', () => {
      logEventTarget('click', docById('container'))
      logEventTarget('click', docById('highest'))
      logEventTarget('click', docById('inside-highest'))
      logEventTarget('click', docById('lowest'))
      logEventTarget('click', docById('inside-lowest'))
      logEventTarget('click', docQuery('shadow-dom-element'))
      logEventTarget(
        'click',
        docQuery('shadow-dom-element').shadowRoot!.querySelector('div')!
      )

      docById('container').addEventListener(
        'click',
        dispatchToUnderlyingElements
      )

      document.elementFromPoint(0, 0)!.dispatchEvent(
        new MouseEvent('click', {
          view: window,
          bubbles: true,
          clientX: 0,
          clientY: 0,
        })
      )

      expect(eventTargets.map(getElementLabel)).toEqual([
        // Natural event path:
        'DIV#inside-highest',
        'DIV#highest',
        'DIV#container',
        // Additional events via `dispatchToOtherElements`:
        'DIV#inside-shadow-dom-element',
        'SHADOW-DOM-ELEMENT',
        'DIV#inside-lowest',
        'DIV#lowest',
      ])
    })

    test('event class and properties propagated', () => {
      let receivedEvent!: PointerEvent
      docById('lowest').addEventListener(
        'pointerdown',
        (event: PointerEvent) => {
          receivedEvent = event
        }
      )

      docById('container').addEventListener(
        'pointerdown',
        dispatchToUnderlyingElements
      )

      document.elementFromPoint(0, 0)!.dispatchEvent(
        new PointerEvent('pointerdown', {
          view: window,
          bubbles: true,
          clientX: 0,
          clientY: 0,
          pointerId: 1,
        })
      )

      expect(receivedEvent).instanceOf(PointerEvent)
      expect(receivedEvent.pointerId).toBe(1)
    })

    test('already cancelled event prevents further dispatch', () => {
      logEventTarget('click', docById('highest'))
      logEventTarget('click', docById('lowest'))

      preventDefaultOnHandle('click', docById('highest'))
      docById('container').addEventListener(
        'click',
        dispatchToUnderlyingElements
      )

      document.elementFromPoint(0, 0)!.dispatchEvent(
        new MouseEvent('click', {
          view: window,
          cancelable: true,
          bubbles: true,
          clientX: 0,
          clientY: 0,
        })
      )

      expect(eventTargets.map(getElementLabel)).toEqual(['DIV#highest'])
    })

    test('further dispatch is cancelled mid-way', () => {
      logEventTarget('click', docById('highest'))
      logEventTarget('click', docById('inside-lowest'))
      logEventTarget('click', docById('lowest'))

      preventDefaultOnHandle('click', docById('inside-lowest'))
      docById('container').addEventListener(
        'click',
        dispatchToUnderlyingElements
      )

      document.elementFromPoint(0, 0)!.dispatchEvent(
        new MouseEvent('click', {
          view: window,
          cancelable: true,
          bubbles: true,
          clientX: 0,
          clientY: 0,
        })
      )

      expect(eventTargets.map(getElementLabel)).toEqual([
        'DIV#highest',
        'DIV#inside-lowest',
      ])
    })
  })
})
