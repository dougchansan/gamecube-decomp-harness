/* Historical permuter score-40 candidate. Return type and volatile access require review. */
unsigned long long fn_80214B68(void) {
    extern u32 fn_80136468();
    extern u32 fn_801F54A4();
    extern u8 lbl_80478D78;
    u16 uVar1;
    u8 uVar2;
    u32 pc;
    uVar1 = fn_801F54A4(0, 0, 0xf, 0);
    uVar2 = fn_80136468(uVar1);
    pc = *((volatile u32*)(&lbl_8047B610));
    *((&lbl_80478D78) + 3) = uVar2;
    lbl_8047B610 = pc + 1;
    return;
}
