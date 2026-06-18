import "@testing-library/jest-dom";

// jsdom doesn't implement HTMLCanvasElement.getContext — stub it for chart.js
Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
  value: () => ({
    clearRect: () => {},
    fillRect: () => {},
    beginPath: () => {},
    stroke: () => {},
    fill: () => {},
    arc: () => {},
    moveTo: () => {},
    lineTo: () => {},
    measureText: () => ({ width: 0 }),
    setTransform: () => {},
    drawImage: () => {},
    createLinearGradient: () => ({ addColorStop: () => {} }),
    canvas: { width: 0, height: 0 },
  }),
});
