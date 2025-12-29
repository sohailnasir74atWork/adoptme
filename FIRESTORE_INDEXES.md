# Firestore Indexes Required for Group Chat Features

This document lists all Firestore composite indexes required for the group chat and explore groups features.

## Indexes to Create

### 1. Groups Collection - Active Groups Query
**Collection:** `groups`  
**Fields:**
- `isActive` (Ascending)
- `createdAt` (Descending)

**Query Used:**
```javascript
query(
  collection(firestoreDB, 'groups'),
  where('isActive', '==', true),
  orderBy('createdAt', 'desc'),
  limit(100)
)
```

**Firebase Console Command:**
```
firebase firestore:indexes
```

Or create manually in Firebase Console:
- Go to Firestore → Indexes
- Click "Create Index"
- Collection ID: `groups`
- Fields:
  1. `isActive` - Ascending
  2. `createdAt` - Descending
- Query scope: Collection

### 2. Group Join Requests - Pending Requests by Group
**Collection:** `group_join_requests`  
**Fields:**
- `groupId` (Ascending)
- `status` (Ascending)

**Query Used:**
```javascript
query(
  collection(firestoreDB, 'group_join_requests'),
  where('groupId', '==', groupId),
  where('status', '==', 'pending')
)
```

**Firebase Console Command:**
Create manually in Firebase Console:
- Collection ID: `group_join_requests`
- Fields:
  1. `groupId` - Ascending
  2. `status` - Ascending
- Query scope: Collection

### 3. Group Join Requests - User's Pending Requests
**Collection:** `group_join_requests`  
**Fields:**
- `requesterId` (Ascending)
- `status` (Ascending)

**Query Used:**
```javascript
query(
  collection(firestoreDB, 'group_join_requests'),
  where('requesterId', '==', userId),
  where('status', '==', 'pending')
)
```

**Firebase Console Command:**
Create manually in Firebase Console:
- Collection ID: `group_join_requests`
- Fields:
  1. `requesterId` - Ascending
  2. `status` - Ascending
- Query scope: Collection

## Automatic Index Creation

Firebase will automatically prompt you to create these indexes when you first run queries that require them. You can:

1. Click the link in the error message
2. Or manually create them in Firebase Console → Firestore → Indexes

## Notes

- All indexes are **Collection-scoped** (not Collection Group)
- The `createdAt` field uses Firestore Timestamp, so ordering works correctly
- Indexes may take a few minutes to build, especially if there's existing data

