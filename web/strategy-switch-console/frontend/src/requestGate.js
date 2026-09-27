export function createRequestGate() {
  let generation = 0;
  return {
    begin() {
      generation += 1;
      return generation;
    },
    isCurrent(token) {
      return token === generation;
    },
    invalidate() {
      generation += 1;
    },
  };
}
