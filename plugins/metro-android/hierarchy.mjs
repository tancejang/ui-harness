export async function readFreshHierarchy(adb, file='/sdcard/uih-managed.xml') {
  await adb('shell','rm','-f',file);
  const status=await adb('shell','uiautomator','dump',file);
  if(!status.includes('dumped'))throw new Error('Fresh native hierarchy is not ready');
  const xml=await adb('exec-out','cat',file);
  if(!xml.includes('<hierarchy'))throw new Error('Fresh native hierarchy is invalid');
  return xml;
}
