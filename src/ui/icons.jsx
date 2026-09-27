const S = ({ children, size = 20, fill = 'none', ...rest }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill={fill} stroke="currentColor"
    strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...rest}>
    {children}
  </svg>
);

export const PartIcon = ({ type, size = 22 }) => {
  const p = PART_PATHS[type] ?? PART_PATHS.default;
  return <S size={size}>{p}</S>;
};

const PART_PATHS = {
  default: <><circle cx="12" cy="12" r="7" /></>,
  BreadBai: (<>
    <rect x="2.5" y="5" width="19" height="14" rx="2" />
    <path d="M2.5 12h19" />
    <path d="M6 8.5h.01M9 8.5h.01M12 8.5h.01M15 8.5h.01M18 8.5h.01M6 15.5h.01M9 15.5h.01M12 15.5h.01M15 15.5h.01M18 15.5h.01" strokeWidth="2" />
  </>),
  battery: (<>
    <rect x="3" y="7" width="15" height="10" rx="2" />
    <path d="M18 10.5h2.5v3H18" /><path d="M7 12h4M9 10v4" />
  </>),
  supply: (<>
    <rect x="3" y="6" width="18" height="12" rx="2" /><path d="M6.5 10h7M6.5 13h4" />
    <circle cx="17.5" cy="13.5" r="1.6" />
  </>),
  ground: (<><path d="M12 4v8" /><path d="M7 12h10M9 15.5h6M11 19h2" /></>),
  resistor: (<><path d="M2 12h3l2-5 3 10 3-10 3 10 2-5h4" /></>),
  led: (<>
    <path d="M3 12h5M16 12h5" /><path d="M8 7.5v9l8-4.5z" /><path d="M16 7.5v9" />
    <path d="M13 6l2.5-2.5M15.5 3.5h-2M15.5 3.5v2" />
  </>),
  diode: (<><path d="M3 12h5M16 12h5" /><path d="M8 7.5v9l8-4.5z" /><path d="M16 7.5v9" /></>),
  capacitor: (<><path d="M3 12h7M14 12h7" /><path d="M10 6.5v11M14 6.5v11" /></>),
  pushbutton: (<>
    <rect x="4" y="9" width="16" height="9" rx="2" /><path d="M12 9V5" /><path d="M8.5 5h7" />
  </>),
  toggle: (<>
    <rect x="3" y="12" width="18" height="6" rx="3" /><path d="M9 12L15 5" /><circle cx="15.5" cy="4.5" r="1.8" />
  </>),
  potentiometer: (<>
    <path d="M2 16h3l2-5 3 10 3-10 3 10 2-5h4" /><path d="M12 8V3" /><path d="M9.5 5.5L12 3l2.5 2.5" />
  </>),
  ldr: (<>
    <circle cx="12" cy="13" r="5.5" /><path d="M9.5 15l1.5-4 2 4 1.5-4" />
    <path d="M4 5l2.5 2.5M9 3.2l.8 3M20 5l-2.5 2.5" />
  </>),
  transistor: (<>
    <circle cx="12" cy="12" r="8" /><path d="M6 12h4" /><path d="M10 8v8" />
    <path d="M10 10.5l6-3.5M10 13.5l6 3.5" />
  </>),
  buzzer: (<>
    <path d="M4 9.5v5h3l4 3.5v-12L7 9.5H4z" /><path d="M14.5 9a4 4 0 010 6M17.5 6.5a8 8 0 010 11" />
  </>),
  motor: (<>
    <circle cx="12" cy="12" r="7.5" /><path d="M9 15V9l3 4 3-4v6" />
  </>),
  seg7: (<>
    <rect x="5" y="3.5" width="14" height="17" rx="2" />
    <path d="M9.5 7h4M9 7.5v3.5M14 7.5v3.5M9.5 11.5h4M9 12v3.5M14 12v3.5M9.5 16.5h4" />
  </>),
  voltmeter: (<><circle cx="12" cy="12" r="8" /><path d="M9 9l3 6 3-6" /></>),
  ammeter: (<><circle cx="12" cy="12" r="8" /><path d="M9 15l3-6 3 6M10 13h4" /></>),
  funcgen: (<>
    <rect x="2.5" y="5" width="19" height="14" rx="2" />
    <path d="M6 14c1.5 0 1.5-4 3-4s1.5 4 3 4 1.5-4 3-4 1.5 4 3 4" />
  </>),
};

export const Icon = {
  play: (p) => <S {...p}><path d="M8 5.5l10 6.5-10 6.5z" fill="currentColor" stroke="none" /></S>,
  pause: (p) => <S {...p}><rect x="7" y="5.5" width="3.6" height="13" rx="1.2" fill="currentColor" stroke="none" /><rect x="13.4" y="5.5" width="3.6" height="13" rx="1.2" fill="currentColor" stroke="none" /></S>,
  step: (p) => <S {...p}><path d="M7 5.5l8 6.5-8 6.5z" fill="currentColor" stroke="none" /><rect x="16" y="5.5" width="2.4" height="13" rx="1" fill="currentColor" stroke="none" /></S>,
  reset: (p) => <S {...p}><path d="M4 12a8 8 0 108-8" /><path d="M4 4.5V9h4.5" /></S>,
  undo: (p) => <S {...p}><path d="M4 9h10a5 5 0 010 10h-4" /><path d="M7.5 5.5L4 9l3.5 3.5" /></S>,
  redo: (p) => <S {...p}><path d="M20 9H10a5 5 0 000 10h4" /><path d="M16.5 5.5L20 9l-3.5 3.5" /></S>,
  cursor: (p) => <S {...p}><path d="M6 3.5l12.5 7.6-5.6 1.1L16 19l-2.6 1-3-6.4-3.9 3.6z" /></S>,
  wire: (p) => <S {...p}><circle cx="5.5" cy="17" r="2.2" /><circle cx="18.5" cy="7" r="2.2" /><path d="M7.4 15.8C10 12 10.5 5.5 16.6 6.4" /></S>,
  eye: (p) => <S {...p}><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" /><circle cx="12" cy="12" r="2.8" /></S>,
  home: (p) => <S {...p}><path d="M4 10.5L12 4l8 6.5" /><path d="M6 9.8V19h12V9.8" /></S>,
  frame: (p) => <S {...p}><path d="M4 8.5V4h4.5M15.5 4H20v4.5M20 15.5V20h-4.5M8.5 20H4v-4.5" /></S>,
  save: (p) => <S {...p}><path d="M5 4h11l3 3v13H5z" /><path d="M8.5 4v5h6V4M8.5 19v-5h7v5" /></S>,
  open: (p) => <S {...p}><path d="M3.5 6.5h6l2 2.5h9V19h-17z" /></S>,
  trash: (p) => <S {...p}><path d="M4.5 6.5h15M9.5 6.5V4h5v2.5M6.5 6.5L7.5 20h9l1-13.5" /></S>,
  rotate: (p) => <S {...p}><path d="M20 12a8 8 0 11-2.4-5.7" /><path d="M20 4v4.5h-4.5" /></S>,
  copy: (p) => <S {...p}><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 5.5H6A2 2 0 004 7.5v10" /></S>,
  plus: (p) => <S {...p}><path d="M12 5v14M5 12h14" /></S>,
  close: (p) => <S {...p}><path d="M6 6l12 12M18 6L6 18" /></S>,
  search: (p) => <S {...p}><circle cx="11" cy="11" r="6.5" /><path d="M16 16l4.5 4.5" /></S>,
  library: (p) => <S {...p}><path d="M4 5.5h6v13H4zM13 5.5h3v13h-3z" /><path d="M18.5 6.5l2.5 11.5" /></S>,
  learn: (p) => <S {...p}><path d="M2.5 9.5L12 5l9.5 4.5L12 14z" /><path d="M6.5 11.8V16c1.5 1.6 3.4 2.5 5.5 2.5s4-.9 5.5-2.5v-4.2" /><path d="M21.5 9.5V15" /></S>,
  chevron: (p) => <S {...p}><path d="M9 6l6 6-6 6" /></S>,
};
