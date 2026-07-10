/* Historical permuter score-90 candidate. Semantically suspect: ptr resets in the loop. */
s32 fn_80068738(void) {
    u8* ptr;
    s32 i;
    fn_80105624();
    ptr = (u8*)(&lbl_803A9EA0);
    for (i = 0; i < 4; i++) {
        fn_80068418(ptr, i + 1);
        ptr = (u8*)(&lbl_803A9EA0);
        ptr += 0x1A;
    }
    return 0;
}
