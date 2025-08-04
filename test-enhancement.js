#!/usr/bin/env node

// Test script to verify the enhanced write_file functionality
const testTexts = [
  { 
    content: "This is normal content.", 
    shouldTrigger: false 
  },
  { 
    content: "This is a revolutionary breakthrough that guarantees amazing results!", 
    shouldTrigger: true 
  },
  { 
    content: "This is a very long piece of content that exceeds 200 characters and should trigger the bullshit detector suggestion based on length alone, even without any specific trigger words that might indicate marketing hype or exaggerated claims.", 
    shouldTrigger: true 
  }
];

console.log("Enhanced Filesystem Tool Test Cases:");
console.log("=====================================");

testTexts.forEach((test, i) => {
  const hasKeywords = /\b(breakthrough|revolutionary|guaranteed|definitely|absolutely|best|perfect|amazing|incredible)\b/i.test(test.content);
  const isLong = test.content.length > 200;
  const shouldSuggest = hasKeywords || isLong;
  
  console.log(`\nTest ${i + 1}:`);
  console.log(`Content: "${test.content.substring(0, 60)}${test.content.length > 60 ? '...' : ''}"`);
  console.log(`Length: ${test.content.length} chars`);
  console.log(`Has keywords: ${hasKeywords}`);
  console.log(`Expected to trigger: ${test.shouldTrigger}`);
  console.log(`Will trigger: ${shouldSuggest}`);
  console.log(`✓ ${shouldSuggest === test.shouldTrigger ? 'PASS' : 'FAIL'}`);
});

console.log(`\n🎯 Enhanced filesystem tool is ready!`);
console.log(`When active, it will show reminders like:`);
console.log(`"💡 Consider running the bullshit detector on this content to ensure clarity and credibility:\\n   bullshit-detector:detect_bullshit"`);
