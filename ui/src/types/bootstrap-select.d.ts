declare module '@crestapps/bootstrap-select/dist/js/bootstrap-select.esm.mjs' {
  const Selectpicker: {
    new (element: string | HTMLSelectElement, options?: Record<string, unknown>): any;
    getOrCreateInstance?: (element: HTMLSelectElement) => any;
  };
  export default Selectpicker;
}
