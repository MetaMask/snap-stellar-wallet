import { config as dotenvConfig } from 'dotenv';
import type { GatsbyConfig } from 'gatsby';

dotenvConfig({
  path: `.env`,
});

const config: GatsbyConfig = {
  // This is required to make use of the React 17+ JSX transform.
  jsxRuntime: 'automatic',

  plugins: [
    'gatsby-plugin-svgr',
    'gatsby-plugin-styled-components',
    {
      resolve: 'gatsby-plugin-manifest',
      options: {
        name: 'Template Snap',
        icon: 'src/assets/logo.svg',
        themeColor: '#6F4CFF',
        backgroundColor: '#FFFFFF',
        display: 'standalone',
      },
    },
  ],
};

export default config;
