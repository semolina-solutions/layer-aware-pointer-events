/**
 * A hierarchy of elements.
 */
export interface ElementTree {
  /** The root element of the hierachy. This is typically the <html> element. */
  root: Element
  /**
   * A map, keyed by parent element, of lists of child elements, ordered by
   * precedence; earlier children in each list sit above later children.
   */
  elementsByParent: Map<Element, Element[]>
}

/**
 * A function that returns the initialization properties supplied as the
 * `eventInitDict` argument to the constructor of the `MouseEvent` (or
 * derivative) class.
 */
export type MouseEventInitDictBuilder = (
  originalEvent: MouseEvent
) => MouseEventInit

/**
 * Continues an event dispatch to all remaining underlying elements.
 *
 * This is an event listener that can be installed on an element that contains
 * layered child elements that would otherwise not receive the event. It
 * assumes that the "default path" of event handling has arrived at the
 * element it's attached to via bubbling up, and it should continue to call the
 * underlying layers to ensure all elements receive the event.
 *
 * @param event A `MouseEvent` (or derivative) that bubbled up to a container
 *     of layered elements.
 * @param mouseEventInitDictBuilder See `MouseEventInitDictBuilder` docstring.
 *     The default supplied clones all properties for `MouseEvent` and known
 *     derivatives (`DragEvent`, `PointerEvent`, `WheelEvent`). This may be
 *     overridden to supply subsets or supersets of properties as required.
 */
export function dispatchToUnderlyingElements(
  event: MouseEvent,
  mouseEventInitDictBuilder: MouseEventInitDictBuilder = getMouseEventInitProperties
) {
  if (event.defaultPrevented) return

  const { currentTarget, type, x, y } = event
  if (!isElement(currentTarget)) {
    throw new Error('Expected event.currentTarget to be an Element')
  }

  // Reduce work by starting from the nearest Shadow DOM if possible.
  const dom = findRootNode(currentTarget)
  if (!isDocumentOrShadowRoot(dom)) {
    throw new Error('Expected root node to be a DocumentOrShadowRoot')
  }

  const tree = elementTreeFromPoint(x, y, dom)
  if (!tree) return

  const { elementsByParent } = tree

  const subtree = flattenElementTree(elementsByParent, currentTarget)
  const defaultPathElementSet = getDefaultPathElementSet(
    elementsByParent,
    currentTarget
  )

  const eventInitDict = mouseEventInitDictBuilder(event)
  eventInitDict.bubbles = false

  for (const element of subtree) {
    if (defaultPathElementSet.has(element)) continue

    let clone = constructMouseEvent(event, type, eventInitDict)

    element.dispatchEvent(clone)
    if (clone.defaultPrevented) {
      event.preventDefault()
      break
    }
  }
}

/**
 * Calculates the set of top-level elements in a hierarchy.
 *
 * The first sibling of each hierachy level is included in the set.
 *
 * @param elementsByParent A map, keyed by parent element, of lists of child
 *    elements, ordered by precedence.
 * @param root The root element of `elementsByParent`.
 * @returns The Set of first children.
 */
function getDefaultPathElementSet(
  elementsByParent: Map<Element, Element[]>,
  root: Element
): Set<Element> {
  const firstChild = elementsByParent.get(root)?.[0]
  const subElements = firstChild
    ? getDefaultPathElementSet(elementsByParent, firstChild)
    : []
  const set = new Set<Element>([root, ...subElements])
  return set
}

/**
 * Converts properties of an `ElementTree` into a flattened form, akin to the
 * return type of DocumentOrShadowRoot.elementsFromPoint().
 *
 * @param elementsByParent A map, keyed by parent element, of lists of child
 *    elements, ordered by precedence.
 * @param root The root element of `elementsByParent`.
 * @returns A flattened list of `Element` objects.
 */
export function flattenElementTree(
  elementsByParent: Map<Element, Element[]>,
  root: Element
): Element[] {
  const children = (elementsByParent.get(root) || []).flatMap((child) =>
    flattenElementTree(elementsByParent, child)
  )
  return [...children, root]
}

/**
 * Builds a tree of `Element` objects.
 *
 * Unlike DocumentOrShadowRoot.elementsFromPoint(), which returns a flattened
 * list of elements, this function returns a hierarchical structure.
 *
 * Unlike DocumentOrShadowRoot.elementsFromPoint(), which ignores open Shadow
 * DOMs, this function explores open Shadow DOMs.
 *
 * @param x The horizontal coordinate of a point.
 * @param y The vertical coordinate of a point.
 * @param topDocumentOrShadowRoot The highest `DocumentOrShadowRoot` to search.
 *    Elements from above this may be returned, but excess work will not be
 *    expended in searching unnecessarily there.
 * @returns An `ElementTree` structure, or null if there were no elements found
 *    under the queried coordinates.
 */
export function elementTreeFromPoint(
  x: number,
  y: number,
  topDocumentOrShadowRoot: DocumentOrShadowRoot = document
): ElementTree | null {
  let root: Element | null = null
  const elementsByParent = new Map<Element, Element[]>()
  const processedElements = new Set<Element>()
  const processedShadowRootElements = new Set<Element>()

  function recurse(
    dom: DocumentOrShadowRoot,
    higherPotentialParents: Element[]
  ) {
    const elements = engineIndependentElementsFromPoint(x, y, dom)
    for (const [i, element] of elements.entries()) {
      if (processedElements.has(element)) {
        // Don't repeat work. This must continue rather than break because
        // there may be shadow DOMs to expand occurring after other elements.
        continue
      }
      if (
        hasOpenShadowRoot(element) &&
        !processedShadowRootElements.has(element)
      ) {
        // Encountered an unprocessed shadow-DOM-containing element.
        processedShadowRootElements.add(element)
        recurse(element.shadowRoot, [...higherPotentialParents, element])
      } else {
        // The set of parents as visible in this DOM.
        const potentialParents = new Set(elements.slice(i + 1))
        // Step up the visibility chain until a matching parent is found.
        let parent: Element | null = element.parentElement
        const mutableHigherPotentialParents = [...higherPotentialParents]
        while (true) {
          if (parent) {
            if (potentialParents.has(parent)) {
              addToKeyedList(elementsByParent, parent, element)
              processedElements.add(element)
              break
            } else {
              parent = parent.parentElement
            }
          } else {
            if (mutableHigherPotentialParents.length) {
              parent = mutableHigherPotentialParents.pop()!
            } else {
              root = element
              break // At the top.
            }
          }
        }
      }
    }
  }

  recurse(topDocumentOrShadowRoot, [])

  return root ? { root, elementsByParent: elementsByParent } : null
}

/**
 * Performs DocumentOrShadowRoot.elementsFromPoint() in an engine-independent
 * manner.
 *
 * At the time of writing, the Gecko engine (used in Firefox) has different
 * behavior to other engines. As the behavior of the others is marginally more
 * useful in the context of this package, this function aligns Gecko's output
 * to that of non-Gecko engines.
 *
 * The salient behavior difference is that when queried from a Shadow DOM,
 * Gecko will return elements within that DOM, rather from the <html> element.
 * Another minor difference is that when an element with "pointer-events: none"
 * styling is queried from its Shadow DOM, it will always be included in the
 * resulting list, despite itself not being a potential event target.
 *
 * @param x The horizontal coordinate of a point.
 * @param y The vertical coordinate of a point.
 * @param documentOrShadowRoot The `DocumentOrShadowRoot` to search.
 * @returns An array of `Element` objects, ordered from the topmost to the
 *    bottommost box of the viewport.
 */
export function engineIndependentElementsFromPoint(
  x: number,
  y: number,
  documentOrShadowRoot: DocumentOrShadowRoot = document
): Element[] {
  const elements = documentOrShadowRoot.elementsFromPoint(x, y)
  const lastElement = elements[elements.length - 1]

  if (
    isShadowRoot(documentOrShadowRoot) &&
    lastElement !== document.documentElement
  ) {
    // If we reached here, it's a Gecko engine response from a shadow DOM.
    const higherDom = findRootNode(documentOrShadowRoot.host)
    if (!isDocumentOrShadowRoot(higherDom)) {
      throw new Error('Expected root node to be a DocumentOrShadowRoot')
    }
    const higherElements = engineIndependentElementsFromPoint(x, y, higherDom)
    if (getComputedStyle(documentOrShadowRoot.host).pointerEvents === 'none') {
      if (higherElements[0] === documentOrShadowRoot.host) {
        // Non-Gecko engines exclude Shadow-DOM-hosting elements when the
        // search originates from inside that element's DOM, but includes them
        // when originating from outside, such that the caller is informed that
        // some element, be it the Shadow-DOM-hosting element itself or an
        // element within the Shadow DOM, responds to pointer events. Trimming
        // this element mimicks this same behavior for the Gecko engine.
        higherElements.splice(0, 1)
      }
    }
    return [...elements, ...higherElements]
  } else {
    // Non-Gecko engine or empty elements list.
    return elements
  }
}

function findRootNode(node: Node) {
  while (node.parentNode) node = node.parentNode
  return node
}

function addToKeyedList<K, V>(keyedList: Map<K, V[]>, parent: K, child: V) {
  if (!keyedList.has(parent)) {
    keyedList.set(parent, [])
  }
  keyedList.get(parent)!.push(child)
}

function isElement(value: unknown): value is Element {
  return value instanceof Element
}

type ElementWithOpenShadowRoot = Element & { readonly shadowRoot: ShadowRoot }

function hasOpenShadowRoot(value: Element): value is ElementWithOpenShadowRoot {
  return !!value.shadowRoot
}

function isShadowRoot(value: unknown): value is ShadowRoot {
  return value instanceof ShadowRoot
}

function isDocumentOrShadowRoot(value: unknown): value is DocumentOrShadowRoot {
  return value === document || isShadowRoot(value)
}

function getMouseEventInitProperties(event: MouseEvent) {
  const {
    // EventInit:
    bubbles,
    cancelable,
    composed,
    // UIEventInit:
    detail,
    view,
    // EventModifierInit:
    altKey,
    ctrlKey,
    metaKey,
    shiftKey,
    // MouseEventInit:
    button,
    buttons,
    clientX,
    clientY,
    movementX,
    movementY,
    relatedTarget,
    screenX,
    screenY,
  } = event
  return {
    // EventInit:
    bubbles,
    cancelable,
    composed,
    // UIEventInit:
    detail,
    view,
    // EventModifierInit:
    altKey,
    ctrlKey,
    metaKey,
    modifierAltGraph: event.getModifierState('AltGraph'),
    modifierCapsLock: event.getModifierState('CapsLock'),
    modifierFn: event.getModifierState('Fn'),
    modifierFnLock: event.getModifierState('FnLock'),
    modifierHyper: event.getModifierState('Hyper'),
    modifierNumLock: event.getModifierState('NumLock'),
    modifierScrollLock: event.getModifierState('ScrollLock'),
    modifierSuper: event.getModifierState('Super'),
    modifierSymbol: event.getModifierState('Symbol'),
    modifierSymbolLock: event.getModifierState('SymbolLock'),
    shiftKey,
    // MouseEventInit:
    button,
    buttons,
    clientX,
    clientY,
    movementX,
    movementY,
    relatedTarget,
    screenX,
    screenY,
    // Specific known sub-types:
    ...(event instanceof DragEvent ? getDragEventInitProperties(event) : {}),
    ...(event instanceof PointerEvent
      ? getPointerEventInitProperties(event)
      : {}),
    ...(event instanceof WheelEvent ? getWheelEventInitProperties(event) : {}),
  }
}

function getDragEventInitProperties(event: DragEvent) {
  const { dataTransfer } = event
  return { dataTransfer }
}

function getPointerEventInitProperties(event: PointerEvent) {
  const {
    height,
    isPrimary,
    pointerId,
    pointerType,
    pressure,
    tangentialPressure,
    tiltX,
    tiltY,
    twist,
    width,
  } = event
  const coalescedEvents = event.getCoalescedEvents()
  const predictedEvents = event.getPredictedEvents()
  return {
    coalescedEvents,
    height,
    isPrimary,
    pointerId,
    pointerType,
    predictedEvents,
    pressure,
    tangentialPressure,
    tiltX,
    tiltY,
    twist,
    width,
  }
}

function getWheelEventInitProperties(event: WheelEvent) {
  const { deltaMode, deltaX, deltaY, deltaZ } = event
  return {
    deltaMode,
    deltaX,
    deltaY,
    deltaZ,
  }
}

/**
 * Instantiates a new `MouseEvent` (or derivative) class.
 *
 * @param original Class to create a new instance of.
 * @param type Event type, e.g. 'click'.
 * @param initDict `MouseEventInit` (or derivative) init properties.
 * @returns A new `MouseEvent` (or derivative) with the supplied properties.
 */
function constructMouseEvent(
  original: MouseEvent,
  type: string,
  initDict: MouseEventInit
) {
  const ctor = original.constructor
  return new (ctor.bind.apply(ctor, [null, type, initDict]))()
}
