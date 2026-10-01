/**
 * File export IPC handlers (save dialog, raw file write, and the
 * CSV / JSON / Markdown / Mermaid inventory exporters).
 *
 * Uses ctx.electron.dialog instead of require('electron') directly so this
 * module stays loadable in plain Node tests.
 */
const fs = require('fs');
const { database } = require('../database');
const { logger } = require('../logger');

function register(ipcMain, ctx) {
  ipcMain.handle('save-file', async (event, options) => {
    try {
      const result = await ctx.electron.dialog.showSaveDialog(ctx.mainWindow, {
        title: options.title || 'Save File',
        defaultPath: options.defaultPath,
        filters: options.filters || [],
      });

      if (result.canceled || !result.filePath) {
        return { success: false, canceled: true };
      }

      ctx.lastSavePath = result.filePath;
      return { success: true, filePath: result.filePath };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('write-file', async (event, filePath, content) => {
    if (filePath !== ctx.lastSavePath) {
      return { success: false, error: 'Save location not confirmed' };
    }
    ctx.lastSavePath = null;
    try {
      fs.writeFileSync(filePath, content);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('export-inventory-csv', async (event, filterBaseIds) => {
    try {
      let bases = database.getAllBases();

      // Apply filter if provided
      if (Array.isArray(filterBaseIds) && filterBaseIds.length > 0) {
        const idSet = new Set(filterBaseIds);
        bases = bases.filter((b) => idSet.has(b.id));
      }

      // Create CSV content
      let csv =
        'ID,Name,Permission Level,Table Count,Field Count,Matches Convention,Tags,Description,First Seen,Last Pulled\n';

      for (const base of bases) {
        let tags = '';
        try {
          tags = base.userTags ? JSON.parse(base.userTags).join('; ') : '';
        } catch (err) {
          logger.warn('Main', `Malformed userTags for base "${base.name}" in CSV export:`, err.message);
        }

        const row = [
          base.id,
          `"${(base.name || '').replace(/"/g, '""')}"`,
          base.permissionLevel || '',
          base.tableCount || 0,
          base.fieldCount || 0,
          base.matchesConvention ? 'Yes' : 'No',
          `"${tags}"`,
          `"${(base.userDescription || '').replace(/"/g, '""')}"`,
          base.firstSeenAt || '',
          base.lastPulledAt || '',
        ];
        csv += row.join(',') + '\n';
      }

      return { success: true, data: csv };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('export-inventory-json', async (event, filterBaseIds) => {
    try {
      let bases = database.getAllBases();
      const relationships = database.getAllRelationships();

      // Apply filter if provided
      if (Array.isArray(filterBaseIds) && filterBaseIds.length > 0) {
        const idSet = new Set(filterBaseIds);
        bases = bases.filter((b) => idSet.has(b.id));
      }

      const data = {
        exportedAt: new Date().toISOString(),
        bases: bases.map((base) => {
          let tags = [];
          try {
            tags = base.userTags ? JSON.parse(base.userTags) : [];
          } catch (err) {
            logger.warn('Main', `Malformed userTags for base "${base.name}" in JSON export:`, err.message);
          }

          let schema = null;
          try {
            schema = base.schemaJson ? JSON.parse(base.schemaJson) : null;
          } catch (err) {
            logger.warn('Main', `Malformed schemaJson for base "${base.name}" in JSON export:`, err.message);
          }

          return {
            id: base.id,
            name: base.name,
            permissionLevel: base.permissionLevel,
            tableCount: base.tableCount,
            fieldCount: base.fieldCount,
            matchesConvention: !!base.matchesConvention,
            tags,
            description: base.userDescription || null,
            firstSeenAt: base.firstSeenAt,
            lastPulledAt: base.lastPulledAt,
            schema,
          };
        }),
        relationships: relationships.map((rel) => ({
          id: rel.id,
          sourceBaseId: rel.sourceBaseId,
          targetBaseId: rel.targetBaseId,
          sourceTableName: rel.sourceTableName,
          targetTableName: rel.targetTableName,
          confidence: rel.confidence,
          status: rel.status,
          notes: rel.notes,
        })),
      };

      return { success: true, data: JSON.stringify(data, null, 2) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('export-markdown', async (event, filterBaseIds) => {
    try {
      let bases = database.getAllBases();
      const relationships = database.getAllRelationships();

      // Apply filter if provided
      if (Array.isArray(filterBaseIds) && filterBaseIds.length > 0) {
        const idSet = new Set(filterBaseIds);
        bases = bases.filter((b) => idSet.has(b.id));
      }

      const baseIdSet = new Set(bases.map((b) => b.id));

      // Summary stats
      let totalTables = 0;
      let totalFields = 0;
      for (const base of bases) {
        totalTables += base.tableCount || 0;
        totalFields += base.fieldCount || 0;
      }

      // Filter relationships to only those involving included bases
      const filteredRels = relationships.filter(
        (r) => baseIdSet.has(r.sourceBaseId) && baseIdSet.has(r.targetBaseId),
      );

      // Build base name lookup
      const baseNameMap = {};
      for (const b of bases) {
        baseNameMap[b.id] = b.name;
      }

      let md = '# Airtable Workspace Report\n\n';
      md += `**Generated:** ${new Date().toISOString().split('T')[0]}\n\n`;
      md += '## Summary\n\n';
      md += `| Metric | Count |\n`;
      md += `|--------|-------|\n`;
      md += `| Bases | ${bases.length} |\n`;
      md += `| Tables | ${totalTables} |\n`;
      md += `| Fields | ${totalFields} |\n`;
      md += `| Relationships | ${filteredRels.length} |\n`;
      md += '\n';

      md += '## Bases\n\n';

      for (const base of bases) {
        let tags = [];
        try {
          tags = base.userTags ? JSON.parse(base.userTags) : [];
        } catch (err) {
          logger.warn('Main', `Malformed userTags for base "${base.name}" in Markdown export:`, err.message);
        }

        md += `### ${base.name}\n\n`;
        if (base.userDescription) {
          md += `${base.userDescription}\n\n`;
        }
        md += `- **Permission:** ${base.permissionLevel || 'N/A'}\n`;
        md += `- **Tables:** ${base.tableCount || 0}\n`;
        md += `- **Fields:** ${base.fieldCount || 0}\n`;
        if (tags.length > 0) {
          md += `- **Tags:** ${tags.join(', ')}\n`;
        }
        md += '\n';

        // Parse schema for table details
        let schema = null;
        try {
          schema = base.schemaJson ? JSON.parse(base.schemaJson) : null;
        } catch (err) {
          logger.warn(
            'Main',
            `Malformed schemaJson for base "${base.name}" in Markdown export:`,
            err.message,
          );
        }

        if (schema && schema.tables && schema.tables.length > 0) {
          for (const table of schema.tables) {
            md += `#### ${table.name}\n\n`;
            if (table.fields && table.fields.length > 0) {
              md += '| Field | Type |\n';
              md += '|-------|------|\n';
              for (const field of table.fields) {
                md += `| ${field.name} | ${field.type} |\n`;
              }
              md += '\n';
            }
          }
        }
      }

      if (filteredRels.length > 0) {
        md += '## Relationships\n\n';
        md += '| Source | Target | Type | Confidence | Status |\n';
        md += '|--------|--------|------|------------|--------|\n';

        for (const rel of filteredRels) {
          const sourceName = baseNameMap[rel.sourceBaseId] || rel.sourceBaseId;
          const targetName = baseNameMap[rel.targetBaseId] || rel.targetBaseId;
          const tableInfo = [rel.sourceTableName, rel.targetTableName].filter(Boolean).join(' / ');
          const typeLabel = rel.type ? `${rel.type}${tableInfo ? ': ' + tableInfo : ''}` : tableInfo || 'N/A';
          md += `| ${sourceName} | ${targetName} | ${typeLabel} | ${rel.confidence || 'N/A'} | ${rel.status || 'N/A'} |\n`;
        }
        md += '\n';
      }

      return { success: true, data: md };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('export-mermaid', async (event, filterBaseIds) => {
    try {
      let bases = database.getAllBases();
      const relationships = database.getAllRelationships();

      // Apply filter if provided
      if (Array.isArray(filterBaseIds) && filterBaseIds.length > 0) {
        const idSet = new Set(filterBaseIds);
        bases = bases.filter((b) => idSet.has(b.id));
      }

      const baseIdSet = new Set(bases.map((b) => b.id));

      // Filter relationships to only those involving included bases
      const filteredRels = relationships.filter(
        (r) => baseIdSet.has(r.sourceBaseId) && baseIdSet.has(r.targetBaseId),
      );

      // Sanitize ID for Mermaid (only alphanumeric and underscores)
      const sanitizeId = (id) => id.replace(/[^a-zA-Z0-9_]/g, '_');

      // Escape label text for Mermaid
      const escapeLabel = (text) => text.replace(/"/g, '#quot;');

      let mmd = 'graph LR\n';

      // Define styles for confirmed vs suspected
      mmd += '  classDef confirmed fill:#22c55e,stroke:#16a34a,color:#fff\n';
      mmd += '  classDef suspected fill:#f59e0b,stroke:#d97706,color:#fff\n';
      mmd += '\n';

      // Add nodes
      for (const base of bases) {
        const nodeId = sanitizeId(base.id);
        mmd += `  ${nodeId}["${escapeLabel(base.name)}"]\n`;
      }
      mmd += '\n';

      // Add edges
      for (const rel of filteredRels) {
        const sourceId = sanitizeId(rel.sourceBaseId);
        const targetId = sanitizeId(rel.targetBaseId);
        const tableName = rel.sourceTableName || rel.targetTableName || '';
        const typeLabel = rel.type || 'link';
        const edgeLabel = tableName ? `${typeLabel}: ${escapeLabel(tableName)}` : typeLabel;

        if (rel.confidence === 'confirmed') {
          mmd += `  ${sourceId} -->|"${edgeLabel}"| ${targetId}\n`;
        } else {
          mmd += `  ${sourceId} -.->|"${edgeLabel}"| ${targetId}\n`;
        }
      }

      // Apply styles to connected nodes based on their relationship confidence
      const confirmedNodes = new Set();
      const suspectedNodes = new Set();
      for (const rel of filteredRels) {
        if (rel.confidence === 'confirmed') {
          confirmedNodes.add(sanitizeId(rel.sourceBaseId));
          confirmedNodes.add(sanitizeId(rel.targetBaseId));
        } else {
          suspectedNodes.add(sanitizeId(rel.sourceBaseId));
          suspectedNodes.add(sanitizeId(rel.targetBaseId));
        }
      }

      // Nodes that are only suspected (not also confirmed) get suspected style
      const purelyConfirmed = [...confirmedNodes];
      const purelySuspected = [...suspectedNodes].filter((n) => !confirmedNodes.has(n));

      if (purelyConfirmed.length > 0) {
        mmd += `\n  class ${purelyConfirmed.join(',')} confirmed\n`;
      }
      if (purelySuspected.length > 0) {
        mmd += `  class ${purelySuspected.join(',')} suspected\n`;
      }

      return { success: true, data: mmd };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });
}

module.exports = { register };
