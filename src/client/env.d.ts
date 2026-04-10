declare module '*.css';
declare module '*.svg';
declare module '*.png';
declare module '*.jpg';

declare namespace JSX {
  interface IntrinsicElements {
    'chart-preview-player': React.DetailedHTMLProps<
      React.HTMLAttributes<HTMLElement> & { volume?: string },
      HTMLElement
    >;
  }
}
