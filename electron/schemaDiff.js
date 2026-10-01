/**
 * Calculate the difference between two schema versions
 */
function calculateSchemaDiff(oldSchema, newSchema) {
  const diff = {
    tables: {
      added: [],
      removed: [],
      modified: [],
    },
    fields: {
      added: [],
      removed: [],
      modified: [],
    },
    summary: {
      tablesChanged: 0,
      fieldsChanged: 0,
      hasChanges: false,
    },
  };

  if (!oldSchema || !newSchema) {
    return diff;
  }

  const oldTables = oldSchema.tables || [];
  const newTables = newSchema.tables || [];

  // Create maps for easier lookup
  const oldTableMap = new Map(oldTables.map((t) => [t.id, t]));
  const newTableMap = new Map(newTables.map((t) => [t.id, t]));

  // Find added tables
  for (const newTable of newTables) {
    if (!oldTableMap.has(newTable.id)) {
      diff.tables.added.push({
        id: newTable.id,
        name: newTable.name,
        fieldCount: newTable.fields?.length || 0,
      });
    }
  }

  // Find removed tables
  for (const oldTable of oldTables) {
    if (!newTableMap.has(oldTable.id)) {
      diff.tables.removed.push({
        id: oldTable.id,
        name: oldTable.name,
        fieldCount: oldTable.fields?.length || 0,
      });
    }
  }

  // Find modified tables and field changes
  for (const newTable of newTables) {
    const oldTable = oldTableMap.get(newTable.id);
    if (oldTable) {
      const tableChanges = compareTable(oldTable, newTable);
      if (tableChanges.hasChanges) {
        diff.tables.modified.push({
          id: newTable.id,
          name: newTable.name,
          oldName: oldTable.name !== newTable.name ? oldTable.name : null,
          changes: tableChanges,
        });
      }

      // Track field changes
      diff.fields.added.push(
        ...tableChanges.fields.added.map((f) => ({
          ...f,
          tableName: newTable.name,
          tableId: newTable.id,
        })),
      );
      diff.fields.removed.push(
        ...tableChanges.fields.removed.map((f) => ({
          ...f,
          tableName: newTable.name,
          tableId: newTable.id,
        })),
      );
      diff.fields.modified.push(
        ...tableChanges.fields.modified.map((f) => ({
          ...f,
          tableName: newTable.name,
          tableId: newTable.id,
        })),
      );
    }
  }

  // Calculate summary
  diff.summary.tablesChanged =
    diff.tables.added.length + diff.tables.removed.length + diff.tables.modified.length;
  diff.summary.fieldsChanged =
    diff.fields.added.length + diff.fields.removed.length + diff.fields.modified.length;
  diff.summary.hasChanges = diff.summary.tablesChanged > 0 || diff.summary.fieldsChanged > 0;

  return diff;
}

/**
 * Compare two tables and return changes
 */
function compareTable(oldTable, newTable) {
  const changes = {
    nameChanged: oldTable.name !== newTable.name,
    fields: {
      added: [],
      removed: [],
      modified: [],
    },
    hasChanges: false,
  };

  const oldFields = oldTable.fields || [];
  const newFields = newTable.fields || [];

  const oldFieldMap = new Map(oldFields.map((f) => [f.id, f]));
  const newFieldMap = new Map(newFields.map((f) => [f.id, f]));

  // Find added fields
  for (const newField of newFields) {
    if (!oldFieldMap.has(newField.id)) {
      changes.fields.added.push({
        id: newField.id,
        name: newField.name,
        type: newField.type,
      });
    }
  }

  // Find removed fields
  for (const oldField of oldFields) {
    if (!newFieldMap.has(oldField.id)) {
      changes.fields.removed.push({
        id: oldField.id,
        name: oldField.name,
        type: oldField.type,
      });
    }
  }

  // Find modified fields
  for (const newField of newFields) {
    const oldField = oldFieldMap.get(newField.id);
    if (oldField) {
      const fieldChanges = compareField(oldField, newField);
      if (fieldChanges.hasChanges) {
        changes.fields.modified.push({
          id: newField.id,
          name: newField.name,
          oldName: oldField.name !== newField.name ? oldField.name : null,
          type: newField.type,
          oldType: oldField.type !== newField.type ? oldField.type : null,
          changes: fieldChanges.changes,
        });
      }
    }
  }

  changes.hasChanges =
    changes.nameChanged ||
    changes.fields.added.length > 0 ||
    changes.fields.removed.length > 0 ||
    changes.fields.modified.length > 0;

  return changes;
}

/**
 * Compare two fields and return changes
 */
function compareField(oldField, newField) {
  const changes = [];

  if (oldField.name !== newField.name) {
    changes.push({ property: 'name', old: oldField.name, new: newField.name });
  }

  if (oldField.type !== newField.type) {
    changes.push({ property: 'type', old: oldField.type, new: newField.type });
  }

  // Compare field options if they exist
  const oldOptions = JSON.stringify(oldField.options || {});
  const newOptions = JSON.stringify(newField.options || {});
  if (oldOptions !== newOptions) {
    changes.push({ property: 'options', old: 'changed', new: 'updated' });
  }

  return {
    hasChanges: changes.length > 0,
    changes,
  };
}

/**
 * Check if schema has changed
 */
function hasSchemaChanged(oldSchemaJson, newSchemaJson) {
  if (!oldSchemaJson || !newSchemaJson) return true;

  // Quick string comparison first
  if (oldSchemaJson === newSchemaJson) return false;

  try {
    const oldSchema = JSON.parse(oldSchemaJson);
    const newSchema = JSON.parse(newSchemaJson);
    const diff = calculateSchemaDiff(oldSchema, newSchema);
    return diff.summary.hasChanges;
  } catch {
    return true;
  }
}

module.exports = {
  calculateSchemaDiff,
  hasSchemaChanged,
};
