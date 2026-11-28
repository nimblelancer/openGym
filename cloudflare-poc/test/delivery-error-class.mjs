// Fixed vocabulary only: never return raw HTTP body, logs, stack, headers or URLs.
export function classifyDeliveryError(input){
  const patterns={
    'network-connection-lost':/network connection lost/i,
    'broken-pipe':/\bEPIPE\b|broken pipe/i,
    'connection-reset':/\bECONNRESET\b|connection reset/i,
    'premature-close':/premature close|prematurely closed/i,
    'request-body':/request body|incoming body/i,
    'stream-cancelled':/stream.{0,40}cancel|cancel.{0,40}stream/i,
    'stream-locked':/stream.{0,40}locked|locked.{0,40}stream/i,
    'socket-closed':/socket.{0,40}closed|other side closed/i,
    'workerd':/\bworkerd\b/i,
    'miniflare':/\bminiflare\b/i,
    'proxy':/\bproxy\b/i,
    'undici':/\bundici\b/i,
  };
  const found=Object.entries(patterns).filter(([,p])=>p.test(input)).map(([k])=>k);
  return found.length?found:['unclassified'];
}
