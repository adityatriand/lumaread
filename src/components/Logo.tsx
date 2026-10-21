// PNG, not lumaread-logo.svg: that SVG's wordmark names fonts Sociolla holds no licence for
// The mark alone is shown when the sidebar collapses to an icon rail
export function Logo() {
  return (
    <>
      <img className="logo" src="/lumaread-logo.png" alt="LumaRead" width={144} height={40} />
      <img className="logo-mark" src="/lumaread-ico.jpeg" alt="LumaRead" width={40} height={40} />
    </>
  );
}
