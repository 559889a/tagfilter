import { extension_settings } from '../../extensions.js';
import { setInfoBlock } from '../../utils.js';

export {
    processTagsInText,
    escapeRegExp,
    createRegexFromTag,
    validateTag
};

/**
 * 转义正则表达式中的特殊字符
 * @param {string} string 需要转义的字符串
 * @returns {string} 转义后的字符串
 */
function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 从标签创建正则表达式
 * @param {Object} tag 标签对象，包含开始和结束标签
 * @returns {RegExp|null} 正则表达式对象或null（如果创建失败）
 */
function createRegexFromTag(tag) {
    if (!tag || !tag.openTag || !tag.closeTag) {
        return null;
    }
    
    try {
        const escapedOpenTag = escapeRegExp(tag.openTag);
        const escapedCloseTag = escapeRegExp(tag.closeTag);
        return new RegExp(`${escapedOpenTag}(.*?)${escapedCloseTag}`, 'gs');
    } catch (error) {
        console.error('创建正则表达式失败:', error);
        return null;
    }
}

/**
 * 验证标签配置是否有效
 * @param {Object} tag 标签对象
 * @returns {Object} 包含验证结果和错误信息的对象
 */
function validateTag(tag) {
    const result = { isValid: true, message: '' };
    
    if (!tag.name || tag.name.trim() === '') {
        result.isValid = false;
        result.message = '标签名称不能为空';
        return result;
    }
    
    if (!tag.openTag || tag.openTag.trim() === '') {
        result.isValid = false;
        result.message = '开始标签不能为空';
        return result;
    }
    
    if (!tag.closeTag || tag.closeTag.trim() === '') {
        result.isValid = false;
        result.message = '结束标签不能为空';
        return result;
    }
    
    try {
        const regex = createRegexFromTag(tag);
        if (!regex) {
            result.isValid = false;
            result.message = '无法创建有效的正则表达式';
        }
    } catch (error) {
        result.isValid = false;
        result.message = `正则表达式错误: ${error.message}`;
    }
    
    return result;
}

/**
 * 在文本中处理标签
 * @param {string} text 要处理的文本
 * @param {boolean} removeContent 是否移除标签内容（true用于发送给AI，false用于显示给用户）
 * @returns {string} 处理后的文本
 */
function processTagsInText(text, removeContent = false) {
    if (!text || typeof text !== 'string' || !extension_settings.tagfilter?.tags) {
        return text;
    }
    
    let processedText = text;
    const tags = extension_settings.tagfilter.tags;
    
    for (const tag of tags) {
        if (tag.enabled === false) {
            continue;
        }
        
        const regex = createRegexFromTag(tag);
        if (!regex) {
            continue;
        }
        
        if (removeContent) {
            processedText = processedText.replace(regex, '');
        }
    }
    
    return processedText;
}

/**
 * 分析文本中的标签使用情况
 * @param {string} text 要分析的文本
 * @returns {Object} 包含分析结果的对象
 */
export function analyzeTagsInText(text) {
    if (!text || typeof text !== 'string' || !extension_settings.tagfilter?.tags) {
        return { hasTaggedContent: false, tagMatches: [] };
    }
    
    const tags = extension_settings.tagfilter.tags;
    const tagMatches = [];
    let hasTaggedContent = false;
    
    for (const tag of tags) {
        if (tag.enabled === false) {
            continue;
        }
        
        const regex = createRegexFromTag(tag);
        if (!regex) {
            continue;
        }
        
        const matches = [...text.matchAll(regex)];
        if (matches.length > 0) {
            hasTaggedContent = true;
            tagMatches.push({
                tag: tag,
                matches: matches.map(match => ({
                    fullMatch: match[0],
                    content: match[1],
                    index: match.index
                }))
            });
        }
    }
    
    return { hasTaggedContent, tagMatches };
}

/**
 * 显示标签信息块
 * @param {HTMLElement} infoBlock 信息块元素
 * @param {Object} tag 标签对象
 */
export function showTagInfo(infoBlock, tag) {
    if (!infoBlock || !tag) return;
    
    const regex = createRegexFromTag(tag);
    if (!regex) {
        setInfoBlock(infoBlock, '无法创建正则表达式', 'error');
        return;
    }
    
    const flagInfo = [];
    flagInfo.push(`标签: ${tag.name}`);
    flagInfo.push(`正则表达式: ${regex.toString()}`);
    
    if (tag.enabled) {
        setInfoBlock(infoBlock, flagInfo.join('. '), 'hint');
    } else {
        setInfoBlock(infoBlock, `${flagInfo.join('. ')} (已禁用)`, 'warning');
    }
} 