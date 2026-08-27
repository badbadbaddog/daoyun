import "@testing-library/jest-dom/vitest"

const emptyRect = {
  bottom: 0,
  height: 0,
  left: 0,
  right: 0,
  top: 0,
  width: 0,
  x: 0,
  y: 0,
  toJSON: () => ({}),
}

Object.defineProperty(document, "elementFromPoint", {
  configurable: true,
  value: () => document.body,
})

Object.defineProperty(Range.prototype, "getBoundingClientRect", {
  configurable: true,
  value: () => emptyRect,
})

Object.defineProperty(Range.prototype, "getClientRects", {
  configurable: true,
  value: () => ({ item: () => null, length: 0, [Symbol.iterator]: function* () {} }),
})
