/* Historical permuter score-100 candidate. Semantically suspect: slot resets in the loop. */
void fn_800E8EFC(void) {
    u32 i;
    for (i = 0; i < 6; i++) {
        u8* slot = lbl_80401490;
        fn_801B06DC(*((u32*)(slot + 0x54)));
        fn_801B0880(*((u32*)(slot + 0x54)), 0);
        *((u8*)(slot + 0x50)) = 0;
        slot += 0x58;
    }
}
