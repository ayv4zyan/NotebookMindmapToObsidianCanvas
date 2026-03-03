import { App, Plugin, Notice, Modal, TextComponent, ButtonComponent, PluginSettingTab, Setting, TFile } from 'obsidian';

interface MindmapNode {
  text: string;
  children: MindmapNode[];
}

interface NotebookMindmapSettings {
  openAfterCreate: boolean;
  layout: 'left-to-right' | 'right-to-left' | 'symmetric';
  edgeToEnd: 'arrow' | 'none';
  edgePathfinding: 'bezier' | 'direct' | 'square';
  edgeLineStyle: 'solid' | 'dotted' | 'short-dashed' | 'long-dashed';
  edgeArrowShape: 'triangle' | 'diamond' | 'circle' | 'blunt';
}

const DEFAULT_SETTINGS: NotebookMindmapSettings = {
  openAfterCreate: true,
  layout: 'left-to-right',
  edgeToEnd: 'arrow',
  edgePathfinding: 'bezier',
  edgeLineStyle: 'solid',
  edgeArrowShape: 'triangle',
};

export default class NotebookMindmapPlugin extends Plugin {
  settings: NotebookMindmapSettings;

  async onload() {
    await this.loadSettings();

    this.addCommand({
      id: 'import-notebooklm-mindmap',
      name: 'Import NotebookLM Mindmap',
      callback: async () => await this.importFromClipboard(),
    });

    this.addSettingTab(new NotebookMindmapSettingTab(this.app, this));
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  async importFromClipboard() {
    try {
      const text = await navigator.clipboard.readText();
      if (!text || text.trim() === '') {
        new Notice('Clipboard is empty.');
        return;
      }

      let root: MindmapNode | null = null;
      let title = 'Untitled Mindmap';

      try {
        const data = JSON.parse(text);
        title = data.title || data.root?.text || title;
        root = data.root || data;
      } catch (e) {
        if (text.includes('#') || text.includes('-')) {
          root = this.parseMarkdown(text);
          if (root && root.text) {
            while (root && root.children.length === 1 && root.children[0].children.length > 0) {
              if (title === 'Untitled Mindmap') title = root.text;
              root = root.children[0];
            }
            if (title === 'Untitled Mindmap') title = root.text;
          }
        }
      }

      if (!root) {
        new Notice('Clipboard content is not valid JSON or Markdown mindmap.');
        return;
      }

      const canvasData = this.buildCanvas(root);

      new FilenameModal(this.app, title, async (fileName) => {
        if (!fileName) return;
        const finalName = fileName.endsWith('.canvas') ? fileName : fileName + '.canvas';
        try {
          const file = await this.app.vault.create(finalName, JSON.stringify(canvasData, null, 2));
          new Notice(`Canvas created: ${finalName}`);

          if (this.settings.openAfterCreate && file instanceof TFile) {
            await this.app.workspace.getLeaf().openFile(file);
          }
        } catch (e) {
          new Notice(`Error creating file: ${e.message}`);
        }
      }).open();

    } catch (e) {
      new Notice(`Failed to read clipboard: ${e.message}`);
    }
  }

  parseMarkdown(text: string): MindmapNode | null {
    const lines = text.split('\n').filter(l => l.trim() !== '');
    if (lines.length === 0) return null;

    const root: MindmapNode = { text: '', children: [] };
    const stack: { node: MindmapNode, level: number }[] = [];
    let lastHeaderLevel = 0;

    lines.forEach(line => {
      const headerMatch = line.match(/^(#+)\s+(.*)/);
      const listMatch = line.match(/^(\s*)(?:-\s+|\*\s+|\d+\.\s+)(.*)/);

      if (headerMatch || listMatch) {
        let content = '';
        let level = 0;

        if (headerMatch) {
          level = headerMatch[1].length;
          content = headerMatch[2].trim();
          lastHeaderLevel = level;
        } else if (listMatch) {
          const indent = listMatch[1].length;
          level = lastHeaderLevel + Math.floor(indent / 2) + 1;
          content = listMatch[2].trim();
        }

        const newNode: MindmapNode = { text: content, children: [] };

        if (stack.length === 0) {
          root.text = content;
          stack.push({ node: root, level });
        } else {
          while (stack.length > 0 && stack[stack.length - 1].level >= level) {
            stack.pop();
          }
          if (stack.length > 0) {
            stack[stack.length - 1].node.children.push(newNode);
            stack.push({ node: newNode, level });
          } else {
            root.children.push(newNode);
            stack.push({ node: newNode, level });
          }
        }
      }
    });

    return root.text ? root : null;
  }

  getNodeHeight(text: string): number {
    const charsPerLine = 25;
    const lines = Math.ceil(text.length / charsPerLine) || 1;
    return Math.max(40, lines * 24 + 10);
  }

  buildCanvas(root: MindmapNode) {
    const nodes: any[] = [];
    const edges: any[] = [];
    const nodeWidth = 250;
    const verticalGap = 30;

    const subtreeHeightMap = new Map<MindmapNode, number>();
    const getSubtreeHeight = (node: MindmapNode): number => {
      const nodeH = this.getNodeHeight(node.text);
      if (!node.children || node.children.length === 0) {
        const totalH = nodeH + verticalGap;
        subtreeHeightMap.set(node, totalH);
        return totalH;
      }
      const childrenH = node.children.reduce((acc, child) => acc + getSubtreeHeight(child), 0);
      const finalH = Math.max(nodeH + verticalGap, childrenH);
      subtreeHeightMap.set(node, finalH);
      return finalH;
    };
    getSubtreeHeight(root);

    const traverse = (node: MindmapNode, parentId: string | null, x: number, yCenter: number, direction: 'left' | 'right' | 'root') => {
      const id = Math.random().toString(36).substring(2, 15);
      const height = this.getNodeHeight(node.text);

      nodes.push({
        id,
        type: 'text',
        x: x - nodeWidth / 2,
        y: yCenter - height / 2,
        width: nodeWidth,
        height: height,
        text: node.text,
      });

      if (parentId) {
        const edge: any = {
          id: Math.random().toString(36).substring(2, 15),
          fromNode: parentId,
          fromSide: direction === 'right' ? 'right' : 'left',
          toNode: id,
          toSide: direction === 'right' ? 'left' : 'right',
        };

        if (this.settings.edgeToEnd === 'none') {
          edge.toEnd = 'none';
        }

        const styleAttributes: any = {};
        if (this.settings.edgePathfinding !== 'bezier') {
          styleAttributes.pathfindingMethod = this.settings.edgePathfinding;
        }
        if (this.settings.edgeLineStyle !== 'solid') {
          styleAttributes.path = this.settings.edgeLineStyle;
        }
        if (this.settings.edgeArrowShape !== 'triangle') {
          styleAttributes.arrow = this.settings.edgeArrowShape;
        }

        if (Object.keys(styleAttributes).length > 0) {
          edge.styleAttributes = styleAttributes;
        }

        edges.push(edge);
      }

      if (node.children && node.children.length > 0) {
        const children = node.children;
        const layoutSetting = this.settings.layout;

        if (direction === 'root') {
          if (layoutSetting === 'symmetric') {
            const mid = Math.ceil(children.length / 2);
            const rightGroup = children.slice(0, mid);
            const leftGroup = children.slice(mid);
            const layoutGroup = (group: MindmapNode[], dir: 'left' | 'right') => {
              const groupSumH = group.reduce((acc, child) => acc + (subtreeHeightMap.get(child) || (this.getNodeHeight(child.text) + verticalGap)), 0);
              let groupY = yCenter - groupSumH / 2;
              group.forEach(child => {
                const childH = subtreeHeightMap.get(child) || (this.getNodeHeight(child.text) + verticalGap);
                traverse(child, id, dir === 'right' ? x + 400 : x - 400, groupY + childH / 2, dir);
                groupY += childH;
              });
            };
            layoutGroup(rightGroup, 'right');
            layoutGroup(leftGroup, 'left');
          } else {
            const dir = layoutSetting === 'left-to-right' ? 'right' : 'left';
            const totalH = children.reduce((acc, child) => acc + (subtreeHeightMap.get(child) || (this.getNodeHeight(child.text) + verticalGap)), 0);
            let currentY = yCenter - totalH / 2;
            children.forEach(child => {
              const childH = subtreeHeightMap.get(child) || (this.getNodeHeight(child.text) + verticalGap);
              traverse(child, id, dir === 'right' ? x + 400 : x - 400, currentY + childH / 2, dir);
              currentY += childH;
            });
          }
        } else {
          const totalH = children.reduce((acc, child) => acc + (subtreeHeightMap.get(child) || (this.getNodeHeight(child.text) + verticalGap)), 0);
          let currentY = yCenter - totalH / 2;
          children.forEach(child => {
            const childH = subtreeHeightMap.get(child) || (this.getNodeHeight(child.text) + verticalGap);
            traverse(child, id, direction === 'right' ? x + 400 : x - 400, currentY + childH / 2, direction);
            currentY += childH;
          });
        }
      }
    };

    traverse(root, null, 0, 0, 'root');
    return { nodes, edges };
  }
}

class FilenameModal extends Modal {
  private result: string;
  constructor(app: App, defaultName: string, private onSubmit: (result: string) => void) {
    super(app);
    this.result = defaultName.replace(/[\\/:*?"<>|]/g, '-');
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.createEl('h2', { text: 'Enter Canvas Filename' });
    const textComp = new TextComponent(contentEl).setValue(this.result).onChange((value) => { this.result = value; });
    textComp.inputEl.style.width = '100%';
    textComp.inputEl.focus();
    textComp.inputEl.addEventListener('keydown', (e: KeyboardEvent) => { if (e.key === 'Enter') { e.preventDefault(); this.close(); this.onSubmit(this.result); } });
    const buttonContainer = contentEl.createDiv({ cls: 'modal-button-container' });
    buttonContainer.style.marginTop = '20px';
    buttonContainer.style.display = 'flex';
    buttonContainer.style.justifyContent = 'flex-end';
    new ButtonComponent(buttonContainer).setButtonText('Create').setCta().onClick(() => { this.close(); this.onSubmit(this.result); });
  }
  onClose() { this.contentEl.empty(); }
}

class NotebookMindmapSettingTab extends PluginSettingTab {
  plugin: NotebookMindmapPlugin;
  constructor(app: App, plugin: NotebookMindmapPlugin) { super(app, plugin); this.plugin = plugin; }
  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    const isAdvancedCanvasInstalled = (this.app as any).plugins.getPlugin('advanced-canvas') !== undefined;

    containerEl.createEl('h3', { text: 'General Settings' });

    new Setting(containerEl)
      .setName('Open after create')
      .setDesc('Automatically open the canvas file after it is created.')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.openAfterCreate)
        .onChange(async (value) => {
          this.plugin.settings.openAfterCreate = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Mindmap layout')
      .setDesc('Choose the growth direction of the mindmap.')
      .addDropdown(dropdown => dropdown
        .addOption('left-to-right', 'Left to Right')
        .addOption('right-to-left', 'Right to Left')
        .addOption('symmetric', 'Symmetric (Classic Mindmap)')
        .setValue(this.plugin.settings.layout)
        .onChange(async (value: any) => {
          this.plugin.settings.layout = value;
          await this.plugin.saveSettings();
        }));

    const advSection = containerEl.createEl('h3', { text: 'Edge & Arrow Settings (Advanced Canvas)' });
    if (!isAdvancedCanvasInstalled) {
      const notice = containerEl.createEl('p', { text: 'Advanced Canvas plugin not detected. Some settings are disabled.' });
      notice.style.color = 'var(--text-error)';
    }

    new Setting(containerEl)
      .setName('Arrowheads Visibility')
      .setDesc('Show or hide arrowheads (Standard Obsidian logic).')
      .addDropdown(dropdown => {
        dropdown
          .addOption('arrow', 'Show Arrow')
          .addOption('none', 'No Arrow')
          .setValue(this.plugin.settings.edgeToEnd)
          .onChange(async (value: any) => {
            this.plugin.settings.edgeToEnd = value;
            await this.plugin.saveSettings();
            this.display(); // Refresh to disable Arrow Shape if needed
          });
      });

    const arrowShapeSetting = new Setting(containerEl)
      .setName('Arrow Shape')
      .setDesc('Define the shape of the arrowhead (Advanced Canvas logic).')
      .addDropdown(dropdown => dropdown
        .addOption('triangle', 'Triangle (Default)')
        .addOption('diamond', 'Diamond')
        .addOption('circle', 'Circle')
        .addOption('blunt', 'Blunt')
        .setValue(this.plugin.settings.edgeArrowShape)
        .onChange(async (value: any) => {
          this.plugin.settings.edgeArrowShape = value;
          await this.plugin.saveSettings();
        }));

    // Disable Arrow Shape if Arrow Visibility is "No Arrow" or Advanced Canvas is missing
    const arrowShapeDisabled = this.plugin.settings.edgeToEnd === 'none' || !isAdvancedCanvasInstalled;
    arrowShapeSetting.setDisabled(arrowShapeDisabled);
    if (arrowShapeDisabled) arrowShapeSetting.settingEl.style.opacity = '0.5';

    const pathfindingSetting = new Setting(containerEl)
      .setName('Pathfinding Method')
      .setDesc('How lines connect nodes.')
      .addDropdown(dropdown => dropdown
        .addOption('bezier', 'Bezier (Curved)')
        .addOption('direct', 'Direct (Straight)')
        .addOption('square', 'Square (Stepped)')
        .setValue(this.plugin.settings.edgePathfinding)
        .onChange(async (value: any) => {
          this.plugin.settings.edgePathfinding = value;
          await this.plugin.saveSettings();
        }));

    pathfindingSetting.setDisabled(!isAdvancedCanvasInstalled);
    if (!isAdvancedCanvasInstalled) pathfindingSetting.settingEl.style.opacity = '0.5';

    const lineStyleSetting = new Setting(containerEl)
      .setName('Line Style')
      .setDesc('Solid, dotted or dashed lines.')
      .addDropdown(dropdown => dropdown
        .addOption('solid', 'Solid')
        .addOption('dotted', 'Dotted')
        .addOption('short-dashed', 'Short Dashed')
        .addOption('long-dashed', 'Long Dashed')
        .setValue(this.plugin.settings.edgeLineStyle)
        .onChange(async (value: any) => {
          this.plugin.settings.edgeLineStyle = value;
          await this.plugin.saveSettings();
        }));

    lineStyleSetting.setDisabled(!isAdvancedCanvasInstalled);
    if (!isAdvancedCanvasInstalled) lineStyleSetting.settingEl.style.opacity = '0.5';
  }
}
