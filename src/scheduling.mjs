export function nextScope(state) {
  const slots=state.plan.components.length*state.config.budgets.localIterations;
  // A blocking whole-screen layout cannot be repaired reliably by a narrower
  // ownership scope. Keep strict acceptance and repair it before local work.
  const cursor=state.bestEvaluation?.blocking?0:(state.scopeCursor??state.iterations)%(slots+1);
  return {cursor,component:cursor===0?null:state.plan.components[Math.floor((cursor-1)/state.config.budgets.localIterations)]};
}
