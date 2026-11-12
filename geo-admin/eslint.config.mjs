import { defineConfig, globalIgnores } from "eslint/config"
import nextVitals from "eslint-config-next/core-web-vitals"
import nextTs from "eslint-config-next/typescript"

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // 存量代码未按 React Compiler 规范改造：先关闭编译器专属规则，列入待办
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/refs": "off",
      "react-hooks/preserve-manual-memoization": "off",
      "react-hooks/immutability": "off",
      // 50+ 处 useEffect 依赖需逐个评审后补全，暂不阻断（待办）
      "react-hooks/exhaustive-deps": "off",
      // 打卡本地附件预览用 <img>（本地文件不走 next/image 优化）；combobox 输入保留 aria-expanded 模式
      "@next/next/no-img-element": "off",
      "jsx-a11y/role-supports-aria-props": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
    },
  },
  globalIgnores([
    ".next/**",
    "node_modules/**",
    "out/**",
    "build/**",
    "public/**",
    "**/*.generated.ts",
    "next-env.d.ts",
  ]),
])
