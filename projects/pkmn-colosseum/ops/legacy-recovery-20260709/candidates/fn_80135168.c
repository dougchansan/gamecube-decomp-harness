/* Historical permuter score-5 candidate. Preserve current symbol names/types when adapting. */
u32 fn_80135168(void *ptr, u16 kind)
{
  void *base = (void *) 0;
  void *sub;
  if ((kind == 0) || (kind >= 0xB))
  {
    return 0;
  }
  if (ptr == ((void *) 0))
  {
    base = (void *) fn_80129280(0, 0);
    if (base == ((void *) 0))
    {
      return 0;
    }
    ptr = (void *) fn_80129280((u32) base, 1);
    if (ptr == ((void *) 0))
    {
      return 0;
    }
  }
  sub = fn_80135CD0(ptr);
  if (sub == ((void *) 0))
  {
    return 0;
  }
  switch (kind)
  {
    case 0:
      return (u32) base;
    case 1:
      return fn_80135C78(sub);
    case 2:
      return fn_80135C40(sub);
    case 3:
      return fn_80135C28(sub);
    case 4:
      return (s32) fn_80135C10(sub);
    case 5:
      return fn_80135BF8(sub);
    case 6:
      return fn_80135BE0(sub);
    case 7:
      if (1)
    {
      return fn_80135BC8(sub);
    }
    case 8:
      return fn_80135BB0(sub);
    default:
      return 0;
  }
}
