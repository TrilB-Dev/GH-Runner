declare module '@crestapps/bootstrap-select' {
  const Selectpicker: {
    new (element: string | HTMLSelectElement, options?: Record<string, unknown>): any;
    getOrCreateInstance?: (element: HTMLSelectElement) => any;
  };
  export default Selectpicker;
}
