class Evaluator{constructor(){this.setupListener(),this.shimWindowFunctions()}shimWindowFunctions(){window.open=function(){pm.logger.error("window.open is not allowed from script sandbox")}}setupListener(){JSON.parse;console.fileLog=function(o,s){console.log(o+": "+s)},window.addEventListener("message",(function(o){o.source;"sandboxEchoText"!==o.data.command||o.source.postMessage({type:"sandboxEchoResponse",result:!0},o.origin)}))}}