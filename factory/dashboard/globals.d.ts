// The chart library loads from a script tag, so it is a global. Only the parts the page uses are typed.
declare const Chart: {
  defaults: { color: string; font: { family: string; size: number } };
  new (canvas: HTMLElement, config: object): object;
};
