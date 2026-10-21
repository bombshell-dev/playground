//! Canonical color keyword table (CSS Color 3 named colors).
//!
//! lightningcss canonicalized named colors to hex at compile time; the
//! runtime consumes hex/functional colors directly, so this table keeps
//! the IR byte-for-byte compatible with the previous front-end.

/// Shortest-hex form for every CSS named color (lowercase).
pub(crate) fn named_color(name: &str) -> Option<&'static str> {
    // Packed storage: one blob plus u16 (name, hex) offsets. The binary
    // search compares the same slices the old pointer-array table did;
    // packing only changes how the strings live in linear memory.
    OFFSETS
        .binary_search_by(|&(name_off, hex_off)| {
            let end = hex_off - 1;
            BLOB[name_off as usize..end as usize].cmp(name)
        })
        .ok()
        .map(|index| {
            let (_, hex_off) = OFFSETS[index];
            let end = OFFSETS
                .get(index + 1)
                .map(|&(next_name, _)| next_name - 1)
                .unwrap_or(BLOB.len() as u16);
            &BLOB[hex_off as usize..end as usize]
        })
}

const BLOB: &str = "aliceblue\0#f0f8ff\0antiquewhite\0#faebd7\0aqua\0#0ff\0aquamarine\0#7fffd4\0azure\0#f0ffff\0beige\0#f5f5dc\0bisque\0#ffe4c4\0black\0#000\0blanchedalmond\0#ffebcd\0blue\0#00f\0blueviolet\0#8a2be2\0brown\0#a52a2a\0burlywood\0#deb887\0cadetblue\0#5f9ea0\0chartreuse\0#7fff00\0chocolate\0#d2691e\0coral\0#ff7f50\0cornflowerblue\0#6495ed\0cornsilk\0#fff8dc\0crimson\0#dc143c\0cyan\0#0ff\0darkblue\0#00008b\0darkcyan\0#008b8b\0darkgoldenrod\0#b8860b\0darkgray\0#a9a9a9\0darkgreen\0#006400\0darkgrey\0#a9a9a9\0darkkhaki\0#bdb76b\0darkmagenta\0#8b008b\0darkolivegreen\0#556b2f\0darkorange\0#ff8c00\0darkorchid\0#9932cc\0darkred\0#8b0000\0darksalmon\0#e9967a\0darkseagreen\0#8fbc8f\0darkslateblue\0#483d8b\0darkslategray\0#2f4f4f\0darkslategrey\0#2f4f4f\0darkturquoise\0#00ced1\0darkviolet\0#9400d3\0deeppink\0#ff1493\0deepskyblue\0#00bfff\0dimgray\0#696969\0dimgrey\0#696969\0dodgerblue\0#1e90ff\0firebrick\0#b22222\0floralwhite\0#fffaf0\0forestgreen\0#228b22\0fuchsia\0#f0f\0gainsboro\0#dcdcdc\0ghostwhite\0#f8f8ff\0gold\0#ffd700\0goldenrod\0#daa520\0gray\0#808080\0green\0#008000\0greenyellow\0#adff2f\0grey\0#808080\0honeydew\0#f0fff0\0hotpink\0#ff69b4\0indianred\0#cd5c5c\0indigo\0#4b0082\0ivory\0#fffff0\0khaki\0#f0e68c\0lavender\0#e6e6fa\0lavenderblush\0#fff0f5\0lawngreen\0#7cfc00\0lemonchiffon\0#fffacd\0lightblue\0#add8e6\0lightcoral\0#f08080\0lightcyan\0#e0ffff\0lightgoldenrodyellow\0#fafad2\0lightgray\0#d3d3d3\0lightgreen\0#90ee90\0lightgrey\0#d3d3d3\0lightpink\0#ffb6c1\0lightsalmon\0#ffa07a\0lightseagreen\0#20b2aa\0lightskyblue\0#87cefa\0lightslategray\0#778899\0lightslategrey\0#778899\0lightsteelblue\0#b0c4de\0lightyellow\0#ffffe0\0lime\0#0f0\0limegreen\0#32cd32\0linen\0#faf0e6\0magenta\0#f0f\0maroon\0#800000\0mediumaquamarine\0#66cdaa\0mediumblue\0#0000cd\0mediumorchid\0#ba55d3\0mediumpurple\0#9370db\0mediumseagreen\0#3cb371\0mediumslateblue\0#7b68ee\0mediumspringgreen\0#00fa9a\0mediumturquoise\0#48d1cc\0mediumvioletred\0#c71585\0midnightblue\0#191970\0mintcream\0#f5fffa\0mistyrose\0#ffe4e1\0moccasin\0#ffe4b5\0navajowhite\0#ffdead\0navy\0#000080\0oldlace\0#fdf5e6\0olive\0#808000\0olivedrab\0#6b8e23\0orange\0#ffa500\0orangered\0#ff4500\0orchid\0#da70d6\0palegoldenrod\0#eee8aa\0palegreen\0#98fb98\0paleturquoise\0#afeeee\0palevioletred\0#db7093\0papayawhip\0#ffefd5\0peachpuff\0#ffdab9\0peru\0#cd853f\0pink\0#ffc0cb\0plum\0#dda0dd\0powderblue\0#b0e0e6\0purple\0#800080\0rebeccapurple\0#663399\0red\0#f00\0rosybrown\0#bc8f8f\0royalblue\0#4169e1\0saddlebrown\0#8b4513\0salmon\0#fa8072\0sandybrown\0#f4a460\0seagreen\0#2e8b57\0seashell\0#fff5ee\0sienna\0#a0522d\0silver\0#c0c0c0\0skyblue\0#87ceeb\0slateblue\0#6a5acd\0slategray\0#708090\0slategrey\0#708090\0snow\0#fffafa\0springgreen\0#00ff7f\0steelblue\0#4682b4\0tan\0#d2b48c\0teal\0#008080\0thistle\0#d8bfd8\0tomato\0#ff6347\0turquoise\0#40e0d0\0violet\0#ee82ee\0wheat\0#f5deb3\0white\0#fff\0whitesmoke\0#f5f5f5\0yellow\0#ff0\0yellowgreen\0#9acd32\0";

/// (name offset, hex offset) into [`BLOB`], sorted by name; the hex runs
/// to the next entry's name (or the end).
const OFFSETS: &[(u16, u16)] = &[(0, 10), (18, 31), (39, 44), (49, 60), (68, 74), (82, 88), (96, 103), (111, 117), (122, 137), (145, 150), (155, 166), (174, 180), (188, 198), (206, 216), (224, 235), (243, 253), (261, 267), (275, 290), (298, 307), (315, 323), (331, 336), (341, 350), (358, 367), (375, 389), (397, 406), (414, 424), (432, 441), (449, 459), (467, 479), (487, 502), (510, 521), (529, 540), (548, 556), (564, 575), (583, 596), (604, 618), (626, 640), (648, 662), (670, 684), (692, 703), (711, 720), (728, 740), (748, 756), (764, 772), (780, 791), (799, 809), (817, 829), (837, 849), (857, 865), (870, 880), (888, 899), (907, 912), (920, 930), (938, 943), (951, 957), (965, 977), (985, 990), (998, 1007), (1015, 1023), (1031, 1041), (1049, 1056), (1064, 1070), (1078, 1084), (1092, 1101), (1109, 1123), (1131, 1141), (1149, 1162), (1170, 1180), (1188, 1199), (1207, 1217), (1225, 1246), (1254, 1264), (1272, 1283), (1291, 1301), (1309, 1319), (1327, 1339), (1347, 1361), (1369, 1382), (1390, 1405), (1413, 1428), (1436, 1451), (1459, 1471), (1479, 1484), (1489, 1499), (1507, 1513), (1521, 1529), (1534, 1541), (1549, 1566), (1574, 1585), (1593, 1606), (1614, 1627), (1635, 1650), (1658, 1674), (1682, 1700), (1708, 1724), (1732, 1748), (1756, 1769), (1777, 1787), (1795, 1805), (1813, 1822), (1830, 1842), (1850, 1855), (1863, 1871), (1879, 1885), (1893, 1903), (1911, 1918), (1926, 1936), (1944, 1951), (1959, 1973), (1981, 1991), (1999, 2013), (2021, 2035), (2043, 2054), (2062, 2072), (2080, 2085), (2093, 2098), (2106, 2111), (2119, 2130), (2138, 2145), (2153, 2167), (2175, 2179), (2184, 2194), (2202, 2212), (2220, 2232), (2240, 2247), (2255, 2266), (2274, 2283), (2291, 2300), (2308, 2315), (2323, 2330), (2338, 2346), (2354, 2364), (2372, 2382), (2390, 2400), (2408, 2413), (2421, 2433), (2441, 2451), (2459, 2463), (2471, 2476), (2484, 2492), (2500, 2507), (2515, 2525), (2533, 2540), (2548, 2554), (2562, 2568), (2573, 2584), (2592, 2599), (2604, 2616)];

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn table_is_sorted_and_complete() {
        assert_eq!(named_color("aliceblue"), Some("#f0f8ff"));
        assert_eq!(named_color("rebeccapurple"), Some("#663399"));
        assert_eq!(named_color("yellow"), Some("#ff0"));
        assert_eq!(named_color("black"), Some("#000"));
        assert_eq!(named_color("teal"), Some("#008080"));
        assert_eq!(named_color("missing"), None);
        assert_eq!(named_color("zzz"), None);
        assert_eq!(named_color("a"), None);
        assert_eq!(OFFSETS.len(), 148);
        for &(name_off, hex_off) in OFFSETS {
            let hex = &BLOB[hex_off as usize..];
            assert!(hex.starts_with('#'), "{}", &BLOB[name_off as usize..hex_off as usize]);
        }
    }
}
