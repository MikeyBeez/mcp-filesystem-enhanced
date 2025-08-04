# 🚀 Enhanced Tool Discovery & Usage Protocol

## 🎯 Purpose
Ensure Claude discovers and uses enhanced MCP tools effectively, particularly the enhanced filesystem server with bullshit detector integration.

## 📋 Tool Discovery Strategy

### 1. **Session Initialization**
- Check for enhanced versions of standard tools first
- Prefer enhanced tools when available
- Note enhanced features in tool descriptions

### 2. **Enhanced Filesystem Server**
**Server**: `filesystem-enhanced`
**Preference**: Use instead of basic `filesystem` when available

**Key Features**:
- ✅ All 14 standard filesystem functions
- 🎯 Bullshit detector integration in write_file
- ⚡ Locate-based search for better performance  
- 🛡️ Content quality reminders

**Usage Hints**:
- `write_file` → Gets automatic quality suggestions for problematic content
- `search_files` → Up to 1000x faster with locate command
- All functions work identically to standard filesystem

## 🔍 Discovery Reminders

### For Content Creation:
```
💡 The enhanced filesystem server provides automatic content quality suggestions 
when writing files. It will gently remind you to run the bullshit detector on 
content that might benefit from analysis.
```

### For File Operations:
```
⚡ The enhanced filesystem server uses 'locate' for dramatically faster file 
searches (up to 1000x faster than directory traversal) while maintaining all 
standard filesystem functionality.
```

### For Quality Assurance:
```
🛡️ When writing marketing content, documentation, or long text, the enhanced 
filesystem server automatically suggests running the bullshit detector to 
ensure clarity and credibility.
```

## 🎯 Integration Strategy

### Bootstrap Instructions:
1. **Session Start**: Check for enhanced tools availability
2. **Tool Selection**: Prefer enhanced versions when present
3. **User Guidance**: Mention enhanced features when relevant
4. **Quality Workflow**: Guide users toward quality assurance features

### Gentle Reminders:
- **In tool descriptions**: Highlight enhanced capabilities
- **During usage**: Mention performance/quality benefits
- **For content creation**: Suggest quality assurance workflows

## 📊 Expected Benefits

### For Users:
- 🎯 **Better Content Quality**: Automatic suggestions for improvement
- ⚡ **Faster Operations**: Locate-based search performance
- 🛡️ **Quality Assurance**: Gentle reminders for content review
- 🔄 **Seamless Workflow**: Same API with enhanced features

### For Claude:
- 📈 **Tool Awareness**: Clear preference hierarchy  
- 🎯 **Feature Discovery**: Built-in guidance for enhanced capabilities
- 🔄 **Consistent Usage**: Prefer enhanced tools when available
- 💡 **User Education**: Natural integration of quality workflows

## ✅ Implementation Status

- ✅ **Bootstrap Instructions**: Added to Brain memory system
- ✅ **Tool Descriptions**: Enhanced with capability hints
- ✅ **Usage Preferences**: Configured in session memory
- ✅ **Discovery Protocol**: Integrated with task approach protocol

**Result**: Claude will now naturally discover and prefer enhanced tools, providing users with better performance and quality assurance features seamlessly integrated into standard workflows.
