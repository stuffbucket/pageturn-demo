// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

// https://astro.build/config
export default defineConfig({
  site: 'https://stuffbucket.github.io',
  base: '/pageturn-demo/',
  integrations: [
    starlight({
      title: 'pageturn-demo',
      description:
        'An interactive 3D book built with Three.js — design notes, PRDs, architecture, and testing playbook.',
      social: [
        {
          icon: 'github',
          label: 'GitHub',
          href: 'https://github.com/stuffbucket/pageturn-demo',
        },
      ],
      sidebar: [
        {
          label: 'Get started',
          items: [
            { label: 'Quickstart', slug: 'get-started/quickstart' },
            { label: 'Inner-loop debugging', slug: 'get-started/inner-loop-debugging' },
          ],
        },
        {
          label: 'Architecture',
          items: [
            { label: 'Overview', slug: 'architecture/overview' },
            { label: 'Tilted-crease model', slug: 'architecture/tilted-crease-model' },
            { label: 'Spine constraint', slug: 'architecture/spine-constraint' },
            { label: 'Long-press capture pipeline', slug: 'architecture/long-press-capture-pipeline' },
            { label: 'Telemetry pipeline', slug: 'architecture/telemetry-pipeline' },
          ],
        },
        {
          label: 'Design (PRDs)',
          items: [
            { label: 'Page model (developable surface)', slug: 'design/page-model' },
            { label: 'Settle physics (aerodynamic)', slug: 'design/settle-physics' },
            { label: 'Inextensibility constraint', slug: 'design/inextensibility-constraint' },
          ],
        },
        {
          label: 'Testing',
          items: [
            { label: 'Test suite audit', slug: 'testing/test-suite-audit' },
            { label: 'Mutation testing', slug: 'testing/mutation-testing' },
            { label: 'Mutation policy', slug: 'testing/mutation-policy' },
            { label: 'Harness scenarios', slug: 'testing/harness-scenarios' },
          ],
        },
        {
          label: 'Reference',
          items: [
            { label: 'URL flag matrix', slug: 'reference/url-flag-matrix' },
            { label: 'npm script catalog', slug: 'reference/npm-script-catalog' },
          ],
        },
      ],
    }),
  ],
});
