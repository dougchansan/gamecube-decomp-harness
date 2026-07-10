/* Historical score-0 candidate. Evidence only; revalidate in the current TU. */
void fn_8003A520(void) {
    s32 r = 0;
    for (;;) {
        r = fn_80039498(r);
        if ((u32)(r - 3) <= 1) {
            break;
        }
        switch (r) {
        case 0:
            fn_80102510(0x19);
            fn_80102510(0x1b);
            menuCloseSync(0x19, 1);
            menuCloseSync(0x1b, 1);
            fn_8003A10C(0);
            fn_8010264C(0x1b, 0);
            fn_8010264C(0x19, 0);
            break;
        case 1:
            fn_80102510(0x19);
            fn_80102510(0x1a);
            fn_80102510(0x1b);
            menuCloseSync(0x19, 1);
            menuCloseSync(0x1a, 1);
            menuCloseSync(0x1b, 1);
            fn_8017B3E4(0x66f);
            while (fn_8017B2CC(0x66f) == 1) {
                fn_800F0308();
            }
            fn_80018F54(4, 0, 0);
            fn_8017B1CC(0x66f);
            fn_800F915C(0x66f);
            fn_8010264C(0x1a, 0);
            fn_8010264C(0x1b, 0);
            fn_8010264C(0x19, 0);
            break;
        case 2:
            fn_80102510(0x19);
            fn_80102510(0x1b);
            menuCloseSync(0x19, 1);
            menuCloseSync(0x1b, 1);
            fn_8003A10C(1);
            fn_8010264C(0x1b, 0);
            fn_8010264C(0x19, 0);
            break;
        }
    }
}
